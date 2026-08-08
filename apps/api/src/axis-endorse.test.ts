import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type Db } from "@lyra/db";
import { seed, sha256Hex, totpAt, TOTP_STEP_SEC, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import type { Env } from "./env.js";

// docs/27 F5 / docs/specs/gap-axis-design.md §H task 5. Endorsement is not a
// status hop: it appends a version against a policy that is already on risk,
// truncates the version it replaces, and moves the pro-rated difference
// through the ledger. The policy number never changes — it is the same
// contract, mid-term.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");
const PASSWORD = "Gonxt-Demo-2026!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const DAY = 86_400_000;
const exec = { waitUntil() {}, passThroughOnException() {} };
const RISK = { age: 34, sumInsuredMinor: 28_000_000, priorClaims: false, vehicleUse: "private", market: "AE" };

let env: Env;
let database: Db;
let seeded: SeedResult;
let token: string;
let productId: string;
let customerId: string;
let consentId: string;

interface Res<T = any> {
  status: number;
  body: T;
}

async function call<T = any>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<Res<T>> {
  const res = await app.fetch(
    new Request(`http://api.test${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
    }),
    env as never,
    exec as never
  );
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, body: (isJson ? await res.json() : await res.arrayBuffer()) as T };
}

function ok<T>(res: Res<T>, ...accept: number[]): T {
  const allowed = accept.length ? accept : [200, 201, 204];
  if (!allowed.includes(res.status)) {
    throw new Error(`expected ${allowed.join("|")}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Which approval policies this tenant automates, rewritten per test. The gates
 * themselves are proven by J-O1 in journeys.test.ts; each test here automates
 * everything *except* the one gate it is about, so the 403 it asserts is
 * unambiguous.
 */
async function autoApprove(...keys: string[]): Promise<void> {
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...policy, autoApprove: keys }) })
    .where(eq(schema.tenants.id, seeded.tenantId));
}

/** A bound policy of this term, so each test owns a contract nobody else edits. */
async function boundPolicy(policyNo: string, startAt: number): Promise<{ id: string; premiumMinor: number }> {
  const shopped = ok(
    await call("POST", "/v1/dist/quote-requests/shop", {
      productId,
      channelId: seeded.channels.web,
      customerId,
      consentId,
      inputs: RISK,
      currency: "AED"
    }),
    201
  );
  const quoted = (shopped.responses as any[]).filter((r) => r.state === "quoted");
  const best = quoted.slice().sort((a, b) => a.premiumMinor - b.premiumMinor)[0];
  expect(best, "the motor panel returned no quote to bind").toBeTruthy();
  ok(await call("POST", `/v1/dist/quote-requests/${shopped.request.id}/select`, { responseId: best.id }));
  const bound = ok(
    await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, {
      policyNo,
      startAt,
      endAt: startAt + 365 * DAY
    }),
    201
  );
  return { id: bound.policy.id as string, premiumMinor: bound.policy.premiumMinor as number };
}

async function versionsOf(policyId: string) {
  return database
    .select()
    .from(schema.axisPolicyVersions)
    .where(eq(schema.axisPolicyVersions.policyId, policyId));
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
  env = { DB_CLIENT: database, ENVIRONMENT: "development", APP_ORIGIN: "http://localhost:5173" } as unknown as Env;

  const login = await call("POST", "/v1/auth/login", {
    email: "omar.farouk@gonxt.ae",
    password: PASSWORD,
    tenantSlug: "gonxt"
  });
  token = ok(login).token as string;
  const verified = await call("POST", "/v1/auth/mfa/verify", {
    code: await totpAt(DEMO_TOTP_SECRET, Math.floor(Date.now() / 1000 / TOTP_STEP_SEC))
  });
  expect(verified.status).toBe(200);

  productId = (await database.select().from(schema.products).where(eq(schema.products.line, "motor")))[0]!.id;
  const customer = (await database.select().from(schema.customers).limit(1))[0]!;
  customerId = customer.id;
  consentId = customer.consentId!;
}, 120_000);

describe("AXIS endorsement (docs/27 F5)", () => {
  it("appends version 2 and leaves the policy number unchanged", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.endorse");
    const start = Date.now();
    const { id: policyId, premiumMinor } = await boundPolicy("POL-END-1", start);
    const effectiveFrom = start + 90 * DAY;

    const out = ok(
      await call("POST", `/v1/axis/policies/${policyId}/endorse`, {
        effectiveFrom,
        changes: { sumInsuredMinor: 30_000_000 },
        premiumMinor: premiumMinor + 120_000
      })
    );

    expect(out.policy.policyNo).toBe("POL-END-1");
    expect(out.policy.status).toBe("bound");
    expect(out.policy.versionSeq).toBe(2);
    expect(out.policy.currentVersionId).toBe(out.version.id);
    expect(out.policy.premiumMinor).toBe(premiumMinor + 120_000);

    expect(out.version.versionSeq).toBe(2);
    expect(out.version.reason).toBe("endorsement");
    expect(out.version.state).toBe("effective");
    expect(out.version.effectiveFrom).toBe(effectiveFrom);
    expect(out.version.effectiveTo).toBe(start + 365 * DAY);
    expect(out.version.premiumDeltaMinor).toBe(120_000);
    expect(out.version.proRataDays).toBe(275);
    expect(JSON.parse(out.version.termsJson).sumInsuredMinor).toBe(30_000_000);

    // The intervals stay contiguous and non-overlapping (§C.2): version 1 is
    // truncated at the endorsement date and superseded, not left open.
    const versions = (await versionsOf(policyId)).sort((a, b) => a.versionSeq - b.versionSeq);
    expect(versions.length).toBe(2);
    expect(versions[0]!.state).toBe("superseded");
    expect(versions[0]!.effectiveTo).toBe(effectiveFrom);
    expect(versions[0]!.supersededAt).toBeTruthy();
    // Σ premiumDeltaMinor over non-voided versions = head − version 1.
    const sum = versions.reduce((n, v) => n + v.premiumDeltaMinor, 0);
    expect(sum).toBe(out.policy.premiumMinor - versions[0]!.premiumMinor);

    // ENDORSE is financial: the commission difference moves through a balanced
    // batch, never through a column write.
    expect(out.txn.type).toBe("ENDORSE");
    expect(out.txn.state).toBe("settled");
    const legs = await database
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.batchId, out.txn.ledgerBatchId as string));
    expect(legs.length).toBeGreaterThanOrEqual(2);
    const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
    const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
    expect(debit).toBe(credit);

    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "axis.policy.endorse")));
    expect(audits.some((a) => a.subjectRef === policyId)).toBe(true);
    const events = await database
      .select()
      .from(schema.eventOutbox)
      .where(eq(schema.eventOutbox.type, "axis.policy.endorsed"));
    expect(events.some((e) => e.envelopeJson.includes(policyId))).toBe(true);
  });

  it("prices a change without writing anything", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.endorse");
    const start = Date.now();
    const { id: policyId, premiumMinor } = await boundPolicy("POL-END-PREV", start);

    const quote = ok(
      await call("POST", `/v1/axis/policies/${policyId}/endorse/preview`, {
        effectiveFrom: start + 90 * DAY,
        changes: { sumInsuredMinor: 30_000_000 },
        premiumMinor: premiumMinor + 120_000
      })
    );
    expect(quote.premiumDeltaMinor).toBe(120_000);
    expect(quote.proRataDays).toBe(275);
    expect(quote.refundMinor).toBe(0);
    expect(quote.needsApproval).toBe(true);
    expect(quote.needsReferral).toBe(false);

    expect((await versionsOf(policyId)).length).toBe(1);
    const txns = await database
      .select()
      .from(schema.ledgerTxns)
      .where(and(eq(schema.ledgerTxns.tenantId, seeded.tenantId), eq(schema.ledgerTxns.type, "ENDORSE")));
    expect(txns.every((t) => !(t.subjectRefsJson ?? "").includes(policyId))).toBe(true);
  });

  it("a negative premium delta requires dual control", async () => {
    // Everything the endorsement touches is automated except the refund: what
    // is under test is that giving money back is a second pair of eyes.
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.endorse");
    const start = Date.now();
    const { id: policyId, premiumMinor } = await boundPolicy("POL-END-2", start);
    expect(premiumMinor, "the panel's premium is too small to clear the refund threshold").toBeGreaterThan(120_000);

    const res = await call("POST", `/v1/axis/policies/${policyId}/endorse`, {
      effectiveFrom: start + 30 * DAY,
      changes: { sumInsuredMinor: 10_000_000 },
      premiumMinor: premiumMinor - 100_000
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");

    const approvals = await database
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.policyKey, "ledger.refund")));
    const mine = approvals.filter((a) => a.subjectRef.includes(policyId));
    expect(mine.length).toBe(1);
    expect(JSON.parse(mine[0]!.contextJson as string).dualControl).toBe(true);

    // Nothing moved: the gates run before the first write, so a refused refund
    // leaves neither a version 2 nor a journal behind.
    expect((await versionsOf(policyId)).length).toBe(1);
    const refunds = await database
      .select()
      .from(schema.ledgerTxns)
      .where(and(eq(schema.ledgerTxns.tenantId, seeded.tenantId), eq(schema.ledgerTxns.type, "REFUND-ISSUE")));
    expect(refunds.every((t) => !(t.subjectRefsJson ?? "").includes(policyId))).toBe(true);
  });

  it("an agent-raised and desk-raised endorsement of the same change-set share one approval", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral");
    const start = Date.now();
    const { id: policyId, premiumMinor } = await boundPolicy("POL-END-3", start);
    const changes = { sumInsuredMinor: 31_000_000 };

    const first = await call("POST", `/v1/axis/policies/${policyId}/endorse`, {
      effectiveFrom: start + 30 * DAY,
      changes,
      premiumMinor: premiumMinor + 90_000
    });
    expect(first.status).toBe(403);

    // The subject ref is the change-set, hashed exactly as the ORBIT tool
    // hashes it at apps/api/src/engines/orbit-tools.ts — so the approval a
    // customer's agent raises and the one the desk raises are one record.
    const expected = `axis_endorse:${policyId}:${await sha256Hex(JSON.stringify({ changes, reason: null }))}`;
    const raised = await database
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.subjectRef, expected)));
    expect(raised.length).toBe(1);
    expect(raised[0]!.policyKey).toBe("axis.endorse");

    const second = await call("POST", `/v1/axis/policies/${policyId}/endorse`, {
      effectiveFrom: start + 30 * DAY,
      changes,
      premiumMinor: premiumMinor + 90_000
    });
    expect(second.status).toBe(403);
    const again = await database
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, seeded.tenantId), eq(schema.approvals.subjectRef, expected)));
    expect(again.length).toBe(1);
    expect(again[0]!.id).toBe(raised[0]!.id);
  });
});
