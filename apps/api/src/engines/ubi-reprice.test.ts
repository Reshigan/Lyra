import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { permissionsForRole, sha256Hex, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import { endorsePolicy } from "./axis-endorse.js";
import { TelematicsIngest, repriceFromTelemetry, type PolicyRow } from "./telematics.js";

// docs/27 F5 (Group E, task 4): a telemetry-driven price change is an
// endorsement. These tests exist to hold that claim down — same pricing, same
// referral guard, same approval gate, same recipe, with only the transaction
// type recording that a sensor and not an underwriter moved the price.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

const DAY = 86_400_000;
const SOURCE = "telematics:obd:km";
const NOW = Date.UTC(2026, 5, 15, 12);
const START = NOW - 30 * DAY;
const END = NOW + 335 * DAY;

let client: Client;
let ctx: Ctx;
let policy: PolicyRow;

/** A reply the model could plausibly return, in the shape `parseUbi` accepts. */
function reply(premiumDeltaPpm: number, code = "km_band"): string {
  return JSON.stringify({
    premiumDeltaPpm,
    factors: [{ code, weight: 1, evidenceRef: SOURCE }],
    confidence: 0.8
  });
}

function gatewayWith(...replies: string[]): Gateway {
  const stub = makeStub({ replies });
  return new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });
}

/** The change set `repriceFromTelemetry` builds from `reply()`, and its hash. */
async function changeSetHashFor(code = "km_band"): Promise<string> {
  return sha256Hex(
    JSON.stringify({ changes: { [code]: { weight: 1, evidenceRef: SOURCE } }, reason: "ubi_reprice" })
  );
}

/**
 * `conflict()`/`badRequest()` set Error.message to the fixed problem+json title
 * ("Conflict", "Bad request", docs/04 §1); the reason lives on `.detail`. Same
 * assertion shape as `telematics.test.ts`.
 */
async function refusalDetail(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as { detail?: string }).detail ?? String(e);
  }
  throw new Error("expected a refusal, got none");
}

async function txns(type?: string) {
  const rows = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.tenantId, ctx.tenantId));
  return type ? rows.filter((r) => r.type === type) : rows;
}

async function currentVersion() {
  const [row] = await ctx.db
    .select()
    .from(schema.axisPolicyVersions)
    .where(
      and(
        eq(schema.axisPolicyVersions.tenantId, ctx.tenantId),
        eq(schema.axisPolicyVersions.policyId, policy.id),
        eq(schema.axisPolicyVersions.state, "effective")
      )
    );
  return row!;
}

/** Marks a gate satisfied without going through a desk, for the paths under test. */
async function preApprove(subjectRef: string, policyKey: string, amountMinor: number): Promise<void> {
  await ctx.db.insert(schema.approvals).values({
    id: `apr_${policyKey}_${subjectRef.slice(-8)}`,
    tenantId: ctx.tenantId,
    subjectRef,
    policyKey,
    module: policyKey.split(".")[0]!,
    requestedBy: "user:u_test",
    requestedAt: ctx.now - 1000,
    decidedBy: "user:u_desk",
    decision: "approved",
    reason: null,
    contextJson: JSON.stringify({ amountMinor }),
    decidedAt: ctx.now - 1000,
    delegationId: null
  } as never);
}

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  const tenantId = "t_1";
  ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId,
    actor: {
      kind: "user",
      id: "u_test",
      tenantId,
      grants: [{ roleKey: "owner", permissions: permissionsForRole("owner") }]
    },
    requestId: "req_1",
    now: NOW,
    locale: "en",
    // The endorse gate is the tenant's to automate; the refund gate is not, and
    // `endorsePolicy` refuses to let it be (docs/19 §7).
    policy: PolicyJson.parse({ currency: "ZAR", autoApprove: ["axis.endorse"] }),
    entitlements: EntitlementsJson.parse({})
  };

  await ctx.db.insert(schema.products).values({
    id: "prod_ubi",
    tenantId,
    line: "motor",
    nameJson: JSON.stringify({ en: "Motor" }),
    // What the product declares it prices on — the guard that stops a model
    // inventing a rating factor and having it silently priced.
    pricingInputsJson: JSON.stringify({ km_band: {}, harsh_braking: {} }),
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  await ctx.db.insert(schema.axisPolicies).values({
    id: "pol_1",
    tenantId,
    customerId: "cust_1",
    providerId: "prov_1",
    productId: "prod_ubi",
    policyNo: "POL-1",
    versionSeq: 1,
    startAt: START,
    endAt: END,
    premiumMinor: 100_000,
    currency: "ZAR",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  await ctx.db.insert(schema.axisPolicyVersions).values({
    id: "pver_1",
    tenantId,
    policyId: "pol_1",
    versionSeq: 1,
    reason: "issue",
    effectiveFrom: START,
    effectiveTo: END,
    premiumMinor: 100_000,
    taxMinor: 15_000,
    feesMinor: 0,
    commissionMinor: 10_000,
    currency: "ZAR",
    premiumDeltaMinor: 0,
    proRataDays: 365,
    termsJson: JSON.stringify({ km_band: { weight: 0 } }),
    state: "effective",
    issuedBy: "user:u_test",
    issuedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW
  } as never);

  const [row] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, "pol_1"));
  policy = row!;
});

async function ingestKm(...values: number[]): Promise<void> {
  const ingest = new TelematicsIngest(ctx, SOURCE, policy);
  await ingest.ingest(`policy:${policy.id}`, values.map((value, i) => ({ at: NOW - (i + 1) * DAY, value })));
}

describe("endorsePolicy transaction type", () => {
  it("still writes an ENDORSE transaction when no opts are passed", async () => {
    const out = await endorsePolicy(ctx, policy, { changes: { km_band: { weight: 1 } }, premiumMinor: 110_000 });
    expect(out.txn?.type).toBe("ENDORSE");
    expect(out.txn?.idempotencyKey).toMatch(/^axis\.endorse:pol_1:/);
  });

  it("writes a UBI-REPRICE transaction whose journal lines are ENDORSE's, and balanced", async () => {
    const ubi = await endorsePolicy(
      ctx,
      policy,
      { changes: { km_band: { weight: 1 } }, premiumMinor: 110_000 },
      { type: "UBI-REPRICE" }
    );
    expect(ubi.txn?.type).toBe("UBI-REPRICE");

    // Same posting, different provenance: the two types' lines must agree line
    // for line, or "a reprice is an endorsement" is not true of the ledger.
    const reprice = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.txnId, ubi.txn!.id));
    const plain = await endorsePolicy(ctx, ubi.policy, {
      changes: { harsh_braking: { weight: 1 } },
      premiumMinor: 121_000
    });
    const endorse = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.txnId, plain.txn!.id));

    const shape = (ls: typeof reprice) =>
      ls.map((l) => `${l.side}:${l.accountCode}`).sort();
    expect(shape(reprice)).toEqual(shape(endorse));

    const sum = (ls: typeof reprice, side: string) =>
      ls.filter((l) => l.side === side).reduce((s, l) => s + l.amountMinor, 0);
    expect(sum(reprice, "debit")).toBe(sum(reprice, "credit"));
    expect(sum(reprice, "debit")).toBeGreaterThan(0);
  });

  it("gives a reprice and a manual endorsement of the same change set different idempotency keys", async () => {
    const changes = { km_band: { weight: 1 } };
    const first = await endorsePolicy(ctx, policy, { changes, premiumMinor: 110_000 }, { type: "UBI-REPRICE" });
    const second = await endorsePolicy(ctx, first.policy, { changes, premiumMinor: 121_000 });

    // Identical change set, so identical hash — only the prefix separates them.
    const hash = first.txn!.idempotencyKey.split(":").pop();
    expect(second.txn!.idempotencyKey.split(":").pop()).toBe(hash);
    expect(first.txn!.idempotencyKey).not.toBe(second.txn!.idempotencyKey);
    expect(first.txn!.idempotencyKey).toBe(`axis.ubi-reprice:pol_1:${hash}`);
    expect(second.txn!.idempotencyKey).toBe(`axis.endorse:pol_1:${hash}`);
  });
});

describe("repriceFromTelemetry", () => {
  it("refuses when no telemetry is stored, before any model call or transaction", async () => {
    const gw = gatewayWith(reply(100_000));
    expect(await refusalDetail(() => repriceFromTelemetry(ctx, policy, gw))).toMatch(/no telemetry stored/);
    expect(await txns()).toHaveLength(0);
    expect(await ctx.db.select().from(schema.aiAuditLog)).toHaveLength(0);
  });

  it("returns repriced:false on a zero adjustment, opening no transaction and no approval", async () => {
    await ingestKm(120, 95);
    const out = await repriceFromTelemetry(ctx, policy, gatewayWith(reply(0)));
    expect(out).toEqual({ repriced: false });
    // TELEM-INGEST is the ingest's own row; the reprice adds nothing.
    expect(await txns("UBI-REPRICE")).toHaveLength(0);
    expect(await ctx.db.select().from(schema.approvals)).toHaveLength(0);
    expect((await currentVersion()).versionSeq).toBe(1);
  });

  it("returns repriced:false when the model names no evidenced factor, however large the delta", async () => {
    await ingestKm(120);
    const unevidenced = JSON.stringify({ premiumDeltaPpm: 200_000, factors: [{ code: "km_band", weight: 1 }] });
    const out = await repriceFromTelemetry(ctx, policy, gatewayWith(unevidenced));
    expect(out).toEqual({ repriced: false });
    expect(await txns("UBI-REPRICE")).toHaveLength(0);
  });

  it("raises the premium by the ppm arithmetic exactly, in minor units", async () => {
    await ingestKm(120, 95, 140);
    const out = await repriceFromTelemetry(ctx, policy, gatewayWith(reply(100_000)));
    expect(out.repriced).toBe(true);
    // 100_000 minor + round(100_000 * 100_000 / 1e6) = 110_000.
    expect(out.repriced && out.premiumMinor).toBe(110_000);
    const version = await currentVersion();
    expect(version.versionSeq).toBe(2);
    expect(version.premiumMinor).toBe(110_000);
    expect((await txns("UBI-REPRICE"))).toHaveLength(1);
  });

  it("clamps an absurd downward proposal, so the premium cannot be inverted", async () => {
    await ingestKm(20);
    // -900_000 ppm would be -90%; MAX_REPRICE_PPM clamps it to -25%. The engine's
    // own `Math.max(0, …)` floor sits behind that clamp as defence in depth — it
    // is unreachable through `parseUbi` from a positive premium, which is the
    // point: two guards, either of which alone keeps the premium non-negative.
    const hash = await changeSetHashFor();
    const subjectRef = `axis_endorse:${policy.id}:${hash}`;
    await preApprove(`${subjectRef}:refund`, "ledger.refund", 100_000);

    const out = await repriceFromTelemetry(ctx, policy, gatewayWith(reply(-900_000)));
    expect(out.repriced).toBe(true);
    expect(out.repriced && out.premiumMinor).toBe(75_000);
    expect(out.repriced && out.premiumDeltaPpm).toBe(-250_000);
  });

  it("refers a factor code the product does not price on, instead of pricing it", async () => {
    await ingestKm(120);
    expect(
      await refusalDetail(() => repriceFromTelemetry(ctx, policy, gatewayWith(reply(100_000, "moon_phase"))))
    ).toMatch(/needs referral/);
    expect(await txns("UBI-REPRICE")).toHaveLength(0);
    expect((await currentVersion()).versionSeq).toBe(1);
  });

  it("stamps the model-gateway audit id onto the version it produced", async () => {
    await ingestKm(120, 95);
    const out = await repriceFromTelemetry(ctx, policy, gatewayWith(reply(100_000)));
    const stamped = JSON.parse((await currentVersion()).termsJson!) as {
      ubi: { aiAuditId: string; premiumDeltaPpm: number; windowStart: number; windowEnd: number };
    };
    expect(stamped.ubi.aiAuditId).toBe(out.repriced && out.aiAuditId);
    expect(stamped.ubi.premiumDeltaPpm).toBe(100_000);
    expect(stamped.ubi.windowStart).toBe(START);
    expect(stamped.ubi.windowEnd).toBe(NOW);

    // The id must resolve to a real ai_audit_log row, or it answers nothing when
    // a customer disputes the premium.
    const [logged] = await ctx.db
      .select()
      .from(schema.aiAuditLog)
      .where(eq(schema.aiAuditLog.id, stamped.ubi.aiAuditId));
    expect(logged?.purpose).toBe("axis.policy.ubi_reprice");
  });

  it("still requires the axis.endorse approval when the tenant has not automated it", async () => {
    ctx.policy = PolicyJson.parse({ currency: "ZAR" });
    await ingestKm(120, 95);
    await expect(repriceFromTelemetry(ctx, policy, gatewayWith(reply(100_000)))).rejects.toThrow();
    const [pending] = await ctx.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.policyKey, "axis.endorse"));
    expect(pending?.decision).toBe("pending");
    expect(await txns("UBI-REPRICE")).toHaveLength(0);
    expect((await currentVersion()).versionSeq).toBe(1);
  });
});
