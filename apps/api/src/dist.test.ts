import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { id as newId, schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// Regression suite for the distribution router. One describe per defect the
// distribution UI reported against these endpoints; each test is named after
// the defect it reproduces (CLAUDE.md — bugs reproduce before they die).

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const PEOPLE: Record<string, string> = {
  // Two controllers: dist:commissions:adjust is dual-control above the
  // threshold, so an accrual needs one to ask and the other to decide.
  "finance.controller": "faisal.omar",
  "finance.approver": "nadia.rahman",
  "axis.lead": "omar.farouk"
};

let env: Env;
let database: Db;
let seeded: SeedResult;
let tokens: Record<string, string>;

const exec = { waitUntil() {}, passThroughOnException() {} };

async function call<T = any>(
  who: string | null,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const token = who ? tokens[who] : undefined;
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? (JSON.parse(text) as T) : (null as T) };
}

/** Initiator is refused with an approval id, a second person clears it, retry. */
async function throughApproval<T = any>(
  initiator: string,
  approver: string,
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  const first = await call(initiator, method, path, payload, headers);
  expect(first.status).toBe(403);
  const approvalId = (first.body as any).approval_id as string;
  expect(approvalId).toBeTruthy();
  const decided = await call(approver, "POST", `/v1/me/approvals/${approvalId}/decide`, {
    decision: "approved"
  });
  expect(decided.status).toBe(200);
  return call<T>(initiator, method, path, payload, headers);
}

beforeAll(async () => {
  const client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await client.execute(stmt);
  database = drizzle(client) as unknown as Db;
  seeded = await seed(database as never, { mfaSecret: DEMO_TOTP_SECRET });

  env = {
    DB_CLIENT: database,
    ENVIRONMENT: "development",
    APP_ORIGIN: "http://localhost:5173"
  } as unknown as Env;

  tokens = {};
  for (const [role, local] of Object.entries(PEOPLE)) {
    const login = await call(null, "POST", "/v1/auth/login", {
      email: `${local}@gonxt.ae`,
      password: PASSWORD,
      tenantSlug: "gonxt"
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    const verified = await call(
      null,
      "POST",
      "/v1/auth/mfa/verify",
      { code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)) },
      { authorization: `Bearer ${token}` }
    );
    expect(verified.status).toBe(200);
    tokens[role] = token;
  }
}, 120_000);

/* ------------------------------------------------------- 1. accrue is gated */

describe("defect 1: POST /commission-entries/accrue writes a financial position with no approval gate", () => {
  let policyId: string;

  beforeAll(async () => {
    // The renewal-window policy — seeded without a commission entry, so it is
    // the one accrual that can still be posted.
    const rows = await database
      .select()
      .from(schema.axisPolicies)
      .where(eq(schema.axisPolicies.policyNo, "CDR-MOT-2501-664118"));
    policyId = rows[0]!.id;
  });

  it("refuses the first attempt with approval_required and writes nothing", async () => {
    const res = await call("finance.controller", "POST", "/v1/dist/commission-entries/accrue", {
      policyId,
      kind: "new_business"
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");
    expect(res.body.policy_key).toBe("dist.commission_accrue");
    expect(res.body.approval_id).toBeTruthy();

    const written = await database
      .select()
      .from(schema.distCommissionEntries)
      .where(eq(schema.distCommissionEntries.policyId, policyId));
    expect(written).toHaveLength(0);
  });

  it("posts the accrual once the second pair of eyes clears it", async () => {
    const res = await throughApproval(
      "finance.controller",
      "finance.approver",
      "POST",
      "/v1/dist/commission-entries/accrue",
      { policyId, kind: "new_business" },
      { "idempotency-key": `accrue-${policyId}` }
    );
    expect(res.status).toBe(201);
    expect(res.body.state).toBe("accrued");
    expect(res.body.policyId).toBe(policyId);
  });
});

/* ------------------------------------------------- 2. propose is AI-audited */

describe("defect 2: POST /next-best-offers/propose writes no ai_audit_log row", () => {
  it("returns an aiAuditId that resolves to an ai_audit_log row", async () => {
    const customer = (await database.select().from(schema.customers).limit(1))[0]!;
    const res = await call("axis.lead", "POST", "/v1/dist/next-best-offers/propose", {
      customerId: customer.id
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.aiAuditId).toBe("string");

    const rows = await database
      .select()
      .from(schema.aiAuditLog)
      .where(eq(schema.aiAuditLog.id, res.body.aiAuditId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.module).toBe("dist");
    expect(rows[0]!.subjectRef).toBe(customer.id);
    expect(rows[0]!.outcome).toBe("ok");
  });
});

/* --------------------------------------------- 3. surface is a real transition */

describe("defect 3: POST /next-best-offers/:id/surface succeeds while doing nothing", () => {
  async function offer(state: string): Promise<string> {
    const offerId = newId("nbo", Date.now());
    await database.insert(schema.distNextBestOffers).values({
      id: offerId,
      tenantId: seeded.tenantId,
      customerId: "cus_surface_test",
      kind: "cross_sell",
      offeringId: "off_surface_test",
      score: 50,
      reasonKey: "nbo.reason.complements_cover",
      state,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return offerId;
  }

  it("409s naming the actual state instead of 204-ing a no-op", async () => {
    const offerId = await offer("dismissed");
    const res = await call("axis.lead", "POST", `/v1/dist/next-best-offers/${offerId}/surface`);
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain("dismissed");
  });

  it("404s for an offer that does not exist", async () => {
    const res = await call("axis.lead", "POST", "/v1/dist/next-best-offers/nbo_missing/surface");
    expect(res.status).toBe(404);
  });

  it("audits the transition it actually made", async () => {
    const offerId = await offer("proposed");
    const res = await call("axis.lead", "POST", `/v1/dist/next-best-offers/${offerId}/surface`);
    expect(res.status).toBe(204);

    const rows = await database
      .select()
      .from(schema.distNextBestOffers)
      .where(eq(schema.distNextBestOffers.id, offerId));
    expect(rows[0]!.state).toBe("surfaced");

    const audited = await database
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, "dist.nbo.surface"), eq(schema.auditLog.subjectRef, offerId))
      );
    expect(audited).toHaveLength(1);
  });
});

/* --------------------------------- 4 + 6. statement range, limit, currencies */

describe("defects 4 and 6: the statement ignores from/to/limit and sums across currencies", () => {
  const providerId = "prv_statement_test";
  const channelId = "chn_statement_test";

  beforeAll(async () => {
    const rows = [
      { at: 1_000, currency: "AED", premium: 100_00, gross: 10_00, channel: 4_00, net: 6_00, tax: 0 },
      { at: 2_000, currency: "AED", premium: 200_00, gross: 20_00, channel: 8_00, net: 12_00, tax: 0 },
      { at: 3_000, currency: "USD", premium: 50_00, gross: 5_00, channel: 2_00, net: 3_00, tax: 0 }
    ];
    for (const r of rows) {
      await database.insert(schema.distCommissionEntries).values({
        id: newId("ce", r.at),
        tenantId: seeded.tenantId,
        policyId: "pol_statement_test",
        providerId,
        channelId,
        kind: "new_business",
        premiumMinor: r.premium,
        grossCommissionMinor: r.gross,
        channelCommissionMinor: r.channel,
        netCommissionMinor: r.net,
        taxMinor: r.tax,
        currency: r.currency,
        state: "accrued",
        createdAt: r.at,
        updatedAt: r.at
      });
    }
  });

  it("totals per currency rather than adding AED to USD", async () => {
    const res = await call("finance.controller", "GET", `/v1/dist/commission-entries/statement?providerId=${providerId}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    const byCurrency = Object.fromEntries(res.body.totals.map((t: any) => [t.currency, t]));
    expect(Object.keys(byCurrency).sort()).toEqual(["AED", "USD"]);
    expect(byCurrency.AED).toMatchObject({
      count: 2,
      premiumMinor: 300_00,
      receivableMinor: 30_00,
      payableMinor: 12_00,
      netMinor: 18_00,
      taxMinor: 0
    });
    expect(byCurrency.USD).toMatchObject({ count: 1, premiumMinor: 50_00, netMinor: 3_00 });
  });

  it("honours from/to on the range it orders by", async () => {
    const from = await call("finance.controller", "GET", `/v1/dist/commission-entries/statement?providerId=${providerId}&from=2000`);
    expect(from.body.count).toBe(2);
    expect(from.body.entries.every((e: any) => e.createdAt >= 2_000)).toBe(true);

    const to = await call("finance.controller", "GET", `/v1/dist/commission-entries/statement?providerId=${providerId}&to=2000`);
    expect(to.body.count).toBe(2);
    expect(to.body.entries.every((e: any) => e.createdAt <= 2_000)).toBe(true);
  });

  it("totals the whole matching set even when the page is smaller", async () => {
    const res = await call("finance.controller", "GET", `/v1/dist/commission-entries/statement?providerId=${providerId}&limit=1`);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.count).toBe(3);
    const aed = res.body.totals.find((t: any) => t.currency === "AED");
    expect(aed.premiumMinor).toBe(300_00);
  });
});

/* ------------------------------------------------ 5. no reversing one twice */

describe("defect 5: clawback reverses the same accrual twice", () => {
  let entryId: string;

  beforeAll(async () => {
    // The seeded sale's accrual — a real entry with a real policy behind it.
    const policy = (
      await database
        .select()
        .from(schema.axisPolicies)
        .where(eq(schema.axisPolicies.policyNo, "CDR-MOT-2601-778201"))
    )[0]!;
    const rows = await database
      .select()
      .from(schema.distCommissionEntries)
      .where(
        and(
          eq(schema.distCommissionEntries.policyId, policy.id),
          eq(schema.distCommissionEntries.state, "accrued")
        )
      );
    entryId = rows[0]!.id;
  });

  it("refuses a second reversal of an entry already clawed back", async () => {
    const first = await throughApproval(
      "finance.controller",
      "finance.approver",
      "POST",
      `/v1/dist/commission-entries/${entryId}/clawback`,
      { reason: "underwriter cancelled the policy" }
    );
    expect(first.status).toBe(201);

    const second = await call("finance.controller", "POST", `/v1/dist/commission-entries/${entryId}/clawback`, {
      reason: "underwriter cancelled the policy"
    });
    expect(second.status).toBe(409);
    expect(second.body.detail).toContain("clawed back");

    // Exactly one reversal exists for that entry — the double credit never happened.
    const reversals = await database
      .select()
      .from(schema.distCommissionEntries)
      .where(eq(schema.distCommissionEntries.reversalOf, entryId));
    expect(reversals).toHaveLength(1);
  });
});
