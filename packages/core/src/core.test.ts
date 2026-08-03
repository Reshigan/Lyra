import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PolicyJson, EntitlementsJson } from "@lyra/db";
import { audit, chainFor, verifyChain } from "./audit.js";
import { consume, emit, markPublishFailed, MAX_ATTEMPTS, pendingOutbox, type Envelope } from "./events.js";
import { assertChannel, assertPurpose, recordConsent } from "./consent.js";
import { decide, gate } from "./approvals.js";
import { withIdempotency } from "./idempotency.js";
import { permissionsForRole, type Actor } from "./rbac.js";
import type { Ctx } from "./context.js";
import { AppError } from "./errors.js";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "db", "migrations");

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

function actor(roleKey: string, userId = "u_1"): Actor {
  return {
    kind: "user",
    id: userId,
    tenantId: "t_1",
    grants: [{ roleKey, permissions: permissionsForRole(roleKey) }]
  };
}

let client: Client;
let ctx: Ctx;

async function makeCtx(a: Actor = actor("tenant.admin"), now = 1_700_000_000_000): Promise<Ctx> {
  return {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId: "t_1",
    actor: a,
    requestId: "req_1",
    now,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of migrationStatements()) await client.execute(sql);
  ctx = await makeCtx();
});

describe("audit chain", () => {
  it("chains rows and detects tampering", async () => {
    for (const action of ["core.user.create", "core.user.update", "axis.case.approve"]) {
      ctx = { ...ctx, now: ctx.now + 1000 };
      await audit(ctx, { action, subjectRef: "user:u_2", after: { action } });
    }

    const rows = await chainFor(ctx);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.chainHash);
    expect(await verifyChain(rows)).toEqual([]);

    // Edit a row in place, as an attacker with DB access would.
    await client.execute({
      sql: "UPDATE core_audit_log SET action = ? WHERE id = ?",
      args: ["core.user.delete", rows[1]!.id]
    });
    const breaks = await verifyChain(await chainFor(ctx));
    expect(breaks).toEqual([{ id: rows[1]!.id, reason: "hash_mismatch" }]);

    // Deleting a row breaks the link for every row after it.
    await client.execute({ sql: "DELETE FROM core_audit_log WHERE id = ?", args: [rows[1]!.id] });
    const afterDelete = await verifyChain(await chainFor(ctx));
    expect(afterDelete).toEqual([{ id: rows[2]!.id, reason: "prev_mismatch" }]);
  });
});

describe("events", () => {
  it("writes an outbox row and dedupes per consumer", async () => {
    const envelope = await emit(ctx, {
      module: "axis",
      type: "axis.case.issued",
      subject: "case:cs_1",
      data: { premiumMinor: 1000 }
    });
    expect(await pendingOutbox(ctx.db)).toHaveLength(1);

    let runs = 0;
    const handler = async () => {
      runs++;
    };
    expect(await consume(ctx.db, envelope, "orbit", handler, ctx.now)).toBe("processed");
    expect(await consume(ctx.db, envelope, "orbit", handler, ctx.now)).toBe("duplicate");
    expect(await consume(ctx.db, envelope, "ledger", handler, ctx.now)).toBe("processed");
    expect(runs).toBe(2);
  });

  it("skips outbox rows past MAX_ATTEMPTS and dead-letters them, so the drain keeps moving", async () => {
    // A poison row that keeps failing to publish must not sit at the head of the
    // oldest-first batch forever, starving every newer event behind it.
    const poison = await emit(ctx, { module: "core", type: "core.poison", data: {} });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markPublishFailed(ctx.db, poison.id, "boom");
    const fresh = await emit({ ...ctx, now: ctx.now + 1_000 }, { module: "core", type: "core.fresh", data: {} });

    // limit 1: the old code returns only the (older) poison row, forever.
    const batch = await pendingOutbox(ctx.db, 1, ctx.now + 2_000);
    expect(batch.map((e) => e.id)).toEqual([fresh.id]);

    // Dead visibly, not silently dropped: one DLQ row, mirroring the inbox pattern.
    const dlq = await client.execute("SELECT consumer, attempts, error FROM core_event_dlq");
    expect(dlq.rows).toHaveLength(1);
    expect(dlq.rows[0]!["consumer"]).toBe("outbox.publish");
    expect(dlq.rows[0]!["attempts"]).toBe(MAX_ATTEMPTS);
    expect(dlq.rows[0]!["error"]).toBe("boom");

    // A second drain does not re-dead-letter the same row.
    expect((await pendingOutbox(ctx.db, 10, ctx.now + 3_000)).map((e) => e.id)).toEqual([fresh.id]);
    const again = await client.execute("SELECT id FROM core_event_dlq");
    expect(again.rows).toHaveLength(1);
  });

  it("dead-letters after MAX_ATTEMPTS", async () => {
    const envelope: Envelope = await emit(ctx, { module: "orbit", type: "orbit.msg.in", data: {} });
    const boom = async () => {
      throw new Error("nope");
    };
    let result = "";
    for (let i = 0; i < 5; i++) result = await consume(ctx.db, envelope, "axis", boom, ctx.now);
    expect(result).toBe("dead");
    const dlq = await client.execute("SELECT * FROM core_event_dlq");
    expect(dlq.rows).toHaveLength(1);
  });
});

describe("consent", () => {
  it("gates purposes and channels, and honours expiry", async () => {
    await recordConsent(ctx, {
      customerId: "cu_1",
      purposes: { marketing: true },
      channels: { whatsapp: true },
      source: "web"
    });
    await expect(assertPurpose(ctx, "cu_1", "marketing")).resolves.toBeUndefined();
    await expect(assertPurpose(ctx, "cu_1", "profiling")).rejects.toThrow(AppError);
    await expect(assertChannel(ctx, "cu_1", "whatsapp")).resolves.toBeUndefined();
    await expect(assertChannel(ctx, "cu_1", "sms")).rejects.toThrow(AppError);

    // Withdrawal is a new row, not an edit.
    const later = { ...ctx, now: ctx.now + 1 };
    await recordConsent(later, {
      customerId: "cu_1",
      purposes: { marketing: false },
      channels: { whatsapp: true },
      source: "portal"
    });
    await expect(assertPurpose(later, "cu_1", "marketing")).rejects.toThrow(AppError);
    // Service messages still allowed on an opted-in channel.
    await expect(
      assertChannel(later, "cu_1", "whatsapp", { marketing: false })
    ).resolves.toBeUndefined();
  });
});

describe("approvals", () => {
  it("requires an approval, then honours it", async () => {
    const finance = await makeCtx(actor("finance.controller", "u_fin"), ctx.now);
    const initiator = await makeCtx(actor("finance.analyst", "u_ops"), ctx.now);

    await expect(gate(initiator, { policyKey: "ledger.payout", subjectRef: "txn:tx_1" })).rejects.toThrow(
      /Approval required/
    );

    const pending = await client.execute("SELECT id FROM core_approvals");
    const approvalId = pending.rows[0]!.id as string;

    // Dual control: the initiator cannot approve their own request.
    const selfApprove = await makeCtx(actor("finance.controller", "u_ops"), ctx.now);
    await expect(decide(selfApprove, approvalId, "approved")).rejects.toMatchObject({
      code: "bad_request",
      detail: expect.stringContaining("dual control")
    });

    await decide(finance, approvalId, "approved", "statement attached");
    const authorised = await gate(initiator, { policyKey: "ledger.payout", subjectRef: "txn:tx_1" });
    expect(authorised?.decision).toBe("approved");
  });

  it("never auto-approves client money, whatever the tenant policy says", async () => {
    const lax = {
      ...ctx,
      policy: PolicyJson.parse({ autoApprove: ["ledger.client_money_transfer", "signal.budget_move"] })
    };
    await expect(
      gate(lax, { policyKey: "ledger.client_money_transfer", subjectRef: "txn:tx_2" })
    ).rejects.toThrow(/Approval required/);
    // A non-floor policy on the allowlist passes straight through.
    await expect(gate(lax, { policyKey: "signal.budget_move", subjectRef: "bm_1" })).resolves.toBeNull();
  });
});

describe("idempotency", () => {
  it("replays the stored response and rejects a reused key", async () => {
    let calls = 0;
    const run = () =>
      withIdempotency(ctx, "k1", "POST /v1/axis/cases", { a: 1 }, async () => {
        calls++;
        return { id: "cs_1" };
      });

    expect(await run()).toEqual({ id: "cs_1" });
    expect(await run()).toEqual({ id: "cs_1" });
    expect(calls).toBe(1);

    await expect(
      withIdempotency(ctx, "k1", "POST /v1/axis/cases", { a: 2 }, async () => ({ id: "cs_2" }))
    ).rejects.toMatchObject({ code: "conflict", detail: expect.stringContaining("different body") });
  });

  it("lets a failed attempt be retried", async () => {
    await expect(
      withIdempotency(ctx, "k2", "POST /v1/axis/cases", { a: 1 }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(
      await withIdempotency(ctx, "k2", "POST /v1/axis/cases", { a: 1 }, async () => ({ ok: true }))
    ).toEqual({ ok: true });
  });
});

// PII masking lives in pii.test.ts: the fixture there is shaped like a real
// hydrated `core_customers` row, which is the thing the block that used to sit
// here never checked.

describe("tenancy", () => {
  it("keeps another tenant's audit rows out of the chain", async () => {
    await audit(ctx, { action: "core.user.create" });
    const other = await makeCtx(actor("tenant.admin", "u_9"), ctx.now);
    await audit({ ...other, tenantId: "t_2" }, { action: "core.user.create" });
    expect(await chainFor(ctx)).toHaveLength(1);
  });
});
