import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, schema, type Db } from "@lyra/db";
import { seed, totpAt, TOTP_STEP_SEC, type Ctx, type SeedResult } from "@lyra/core";
import { app } from "./index.js";
import { sweepPolicyLifecycle } from "./engines/axis-lifecycle.js";
import type { Env } from "./env.js";

// docs/27 F5 part 2 / docs/specs/gap-axis-design.md §H task 6. The other half of
// the lifecycle: the ways cover stops. Cancellation gives unearned money back
// and claws the matching commission; NTU unwinds a contract that never started;
// lapse and inception are clock events the scheduler fires, not requests;
// reinstatement puts cover back on risk and is never automatic.

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

/** Each test automates every gate except the one it is about. */
async function autoApprove(...keys: string[]): Promise<void> {
  const tenantRow = (await database.select().from(schema.tenants).where(eq(schema.tenants.id, seeded.tenantId)))[0]!;
  const policy = JSON.parse(tenantRow.policyJson as string) as { autoApprove: string[] };
  await database
    .update(schema.tenants)
    .set({ policyJson: JSON.stringify({ ...policy, autoApprove: keys }) })
    .where(eq(schema.tenants.id, seeded.tenantId));
}

async function boundPolicy(policyNo: string, startAt: number) {
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
    await call("POST", `/v1/axis/quote-responses/${best.id}/bind`, { policyNo, startAt, endAt: startAt + 365 * DAY }),
    201
  );
  return {
    id: bound.policy.id as string,
    premiumMinor: bound.policy.premiumMinor as number,
    commissionMinor: bound.policy.commissionMinor as number
  };
}

async function policyRow(policyId: string) {
  return (await database.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policyId)))[0]!;
}

async function versionsOf(policyId: string) {
  return database.select().from(schema.axisPolicyVersions).where(eq(schema.axisPolicyVersions.policyId, policyId));
}

async function txnsOf(policyId: string, type: string) {
  const rows = await database
    .select()
    .from(schema.ledgerTxns)
    .where(and(eq(schema.ledgerTxns.tenantId, seeded.tenantId), eq(schema.ledgerTxns.type, type)));
  return rows.filter((t) => (t.subjectRefsJson ?? "").includes(policyId));
}

async function eventsFor(policyId: string, type: string) {
  const rows = await database.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, type));
  return rows.filter((e) => e.envelopeJson.includes(policyId));
}

/** Both sides of every batch the transaction posted. */
async function balanced(batchId: string) {
  const legs = await database
    .select()
    .from(schema.ledgerJournalLines)
    .where(eq(schema.ledgerJournalLines.batchId, batchId));
  const debit = legs.filter((l) => l.side === "debit").reduce((n, l) => n + l.amountMinor, 0);
  const credit = legs.filter((l) => l.side === "credit").reduce((n, l) => n + l.amountMinor, 0);
  return { legs, debit, credit };
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

describe("AXIS policy lifecycle (docs/27 F5)", () => {
  it("cancellation with a pro-rata refund posts CANCEL and a child REFUND-ISSUE", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.cancel");
    const start = Date.now();
    const { id: policyId, commissionMinor } = await boundPolicy("POL-CAN-1", start);
    const effectiveAt = start + 30 * DAY;

    // REFUND-ISSUE is a payout, so docs/19 §7 forbids the tenant automating it.
    // The only way past that gate is a real decision, so grant one up front:
    // what this test is about is the shape of the posting, not the gate.
    await database.insert(schema.approvals).values({
      id: "apr_cancel_refund_1",
      tenantId: seeded.tenantId,
      subjectRef: `axis_cancel:${policyId}:refund`,
      policyKey: "ledger.refund",
      module: "ledger",
      requestedBy: "user:tester",
      requestedAt: Date.now(),
      decidedBy: "user:approver",
      decision: "approved",
      reason: "test fixture",
      contextJson: JSON.stringify({ amountMinor: 1_000_000_00 }),
      decidedAt: Date.now(),
      delegationId: null
    });

    const out = ok(
      await call("POST", `/v1/axis/policies/${policyId}/cancel`, { effectiveAt, reasonCode: "customer_request" })
    );

    expect(out.policy.status).toBe("cancelled");
    expect(out.policy.cancelEffectiveAt).toBe(effectiveAt);
    expect(out.policy.cancelReasonCode).toBe("customer_request");
    expect(out.refundMinor).toBeGreaterThan(0);

    // CANCEL is financial: the unearned commission comes back through a
    // balanced batch, and the customer's money leaves as its own child payout.
    expect(out.txn.type).toBe("CANCEL");
    expect(out.txn.state).toBe("settled");
    const cancelLegs = await balanced(out.txn.ledgerBatchId as string);
    expect(cancelLegs.legs.length).toBeGreaterThanOrEqual(2);
    expect(cancelLegs.debit).toBe(cancelLegs.credit);
    // Only the unearned share is clawed back — the 30 days on risk were earned.
    expect(out.clawbackMinor).toBeGreaterThan(0);
    expect(out.clawbackMinor).toBeLessThan(commissionMinor);

    expect(out.refundTxn.type).toBe("REFUND-ISSUE");
    expect(out.refundTxn.parentTxnId).toBe(out.txn.id);
    expect(out.refundTxn.grossMinor).toBe(out.refundMinor);
    const refundLegs = await balanced(out.refundTxn.ledgerBatchId as string);
    expect(refundLegs.debit).toBe(refundLegs.credit);

    // §C.2: cancellation truncates the effective version, it does not append
    // one. A zero-length cancellation version would break the interval
    // invariant, and superseding without a successor would leave none effective.
    const versions = await versionsOf(policyId);
    expect(versions.length).toBe(1);
    expect(versions[0]!.state).toBe("effective");
    expect(versions[0]!.effectiveTo).toBe(effectiveAt);

    expect((await eventsFor(policyId, "axis.policy.cancelled")).length).toBe(1);
    const audits = await database
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, seeded.tenantId), eq(schema.auditLog.action, "axis.policy.cancel")));
    expect(audits.some((a) => a.subjectRef === policyId)).toBe(true);
  });

  it("cancellation with nil refund needs no second approver", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.cancel");
    const start = Date.now();
    const { id: policyId } = await boundPolicy("POL-CAN-2", start);

    // Forfeited premium: the cover ends but the customer gets nothing back, so
    // no payout is raised and `ledger.refund` is never reached.
    const out = ok(
      await call("POST", `/v1/axis/policies/${policyId}/cancel`, {
        effectiveAt: start + 30 * DAY,
        reasonCode: "non_payment",
        refundMethod: "none"
      })
    );

    expect(out.policy.status).toBe("cancelled");
    expect(out.refundMinor).toBe(0);
    expect(out.refundTxn).toBeNull();
    expect(await txnsOf(policyId, "REFUND-ISSUE")).toEqual([]);

    // The commission still comes back — forfeiting the refund does not make the
    // unearned months earned — so CANCEL still posts.
    expect(out.txn.type).toBe("CANCEL");
    const legs = await balanced(out.txn.ledgerBatchId as string);
    expect(legs.debit).toBe(legs.credit);

    const raised = await database
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.tenantId, seeded.tenantId));
    expect(raised.filter((a) => a.subjectRef.includes(policyId))).toEqual([]);
  });

  it("lapse fires after grace and emits orbit.renewal.lost", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral");
    const now = Date.now();
    const start = now - 60 * DAY;
    const { id: policyId, premiumMinor } = await boundPolicy("POL-LAPSE-1", start);

    // Instalment 2 fell due 40 days ago and grace is 15, so cover has been
    // unpaid past the grace window for 25 days.
    await database
      .update(schema.axisPolicies)
      .set({
        paymentPlanJson: JSON.stringify({
          frequency: "monthly",
          graceDays: 15,
          lapseOnMissed: true,
          instalments: [
            { seq: 1, dueAt: start, grossMinor: Math.round(premiumMinor / 12), state: "paid" },
            { seq: 2, dueAt: now - 40 * DAY, grossMinor: Math.round(premiumMinor / 12), state: "due" }
          ]
        })
      })
      .where(eq(schema.axisPolicies.id, policyId));

    // The scheduler runs as `system` with no grants (apps/api/src/index.ts), so
    // the sweep is driven directly rather than over HTTP.
    const sysCtx: Ctx = {
      db: database as unknown as Ctx["db"],
      tenantId: seeded.tenantId,
      actor: { kind: "system", id: "scheduler", tenantId: seeded.tenantId, grants: [] },
      requestId: "req_sweep",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await sweepPolicyLifecycle(sysCtx);

    const row = await policyRow(policyId);
    // Inception and lapse are both clock events; one sweep walks the policy
    // through both, in order.
    expect(row.inceptedAt).toBeTruthy();
    expect(row.status).toBe("lapsed");
    expect(row.lapsedAt).toBeTruthy();

    // LAPSE moves no money (docs/19 §4.1) but is still a transaction, so a
    // mis-fired sweep is reversible.
    const lapses = await txnsOf(policyId, "LAPSE");
    expect(lapses.length).toBe(1);
    expect(lapses[0]!.ledgerBatchId).toBeNull();

    expect((await eventsFor(policyId, "axis.policy.lapsed")).length).toBe(1);
    // ORBIT's renewal pipeline is driven by this and nothing else (CLAUDE.md §6).
    expect((await eventsFor(policyId, "orbit.renewal.lost")).length).toBe(1);
  });

  // Regression: the stored plan is not a request body, so bounding `dueAt` to
  // the Date range here only decided what to do when the column is already
  // wrong — and `safeParse` failing makes `missedInstalment` return null, which
  // switches lapse-on-missed off for the *whole* plan. One unrenderable
  // instalment must not buy the other one free cover.
  it("still lapses on a genuinely missed instalment when another one is out of Date range", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral");
    const now = Date.now();
    const start = now - 60 * DAY;
    const { id: policyId, premiumMinor } = await boundPolicy("POL-LAPSE-2", start);

    await database
      .update(schema.axisPolicies)
      .set({
        paymentPlanJson: JSON.stringify({
          frequency: "monthly",
          graceDays: 15,
          lapseOnMissed: true,
          instalments: [
            { seq: 1, dueAt: start, grossMinor: Math.round(premiumMinor / 12), state: "paid" },
            { seq: 2, dueAt: now - 40 * DAY, grossMinor: Math.round(premiumMinor / 12), state: "due" },
            // Past the end of the Date range; no `new Date()` renderer here.
            { seq: 3, dueAt: 9e15, grossMinor: Math.round(premiumMinor / 12), state: "due" }
          ]
        })
      })
      .where(eq(schema.axisPolicies.id, policyId));

    const sysCtx: Ctx = {
      db: database as unknown as Ctx["db"],
      tenantId: seeded.tenantId,
      actor: { kind: "system", id: "scheduler", tenantId: seeded.tenantId, grants: [] },
      requestId: "req_sweep_oob",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await sweepPolicyLifecycle(sysCtx);

    const row = await policyRow(policyId);
    expect(row.status).toBe("lapsed");
    expect((await txnsOf(policyId, "LAPSE")).length).toBe(1);
  });

  it("reinstatement always needs dual control", async () => {
    // `axis.reinstate` is on the allowlist and still gates: putting cover back
    // on risk after a lapse is never automatic (docs/19 §4.1).
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.reinstate");
    const start = Date.now() - 30 * DAY;
    const { id: policyId } = await boundPolicy("POL-REIN-1", start);
    await database
      .update(schema.axisPolicies)
      .set({ status: "lapsed", inceptedAt: start, lapsedAt: Date.now() - DAY })
      .where(eq(schema.axisPolicies.id, policyId));

    const res = await call("POST", `/v1/axis/policies/${policyId}/reinstate`, {
      arrearsMinor: 50_000,
      note: "arrears collected"
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("approval_required");

    const raised = (await database.select().from(schema.approvals).where(eq(schema.approvals.tenantId, seeded.tenantId)))
      .filter((a) => a.subjectRef.includes(policyId) && a.policyKey === "axis.reinstate");
    expect(raised.length).toBe(1);
    expect(JSON.parse(raised[0]!.contextJson as string).dualControl).toBe(true);

    // Nothing moved: the gate runs before the first write.
    expect((await policyRow(policyId)).status).toBe("lapsed");
    expect(await txnsOf(policyId, "REINSTATE")).toEqual([]);
  });

  it("NTU before inception claws back commission", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.ntu");
    const start = Date.now() + 10 * DAY;
    const { id: policyId, commissionMinor } = await boundPolicy("POL-NTU-1", start);
    expect(commissionMinor).toBeGreaterThan(0);

    const out = ok(await call("POST", `/v1/axis/policies/${policyId}/ntu`, { reasonCode: "cooling_off" }));

    expect(out.policy.status).toBe("ntu");
    // NTU itself moves no money — the contract simply never existed. The
    // money that already moved comes back as children.
    expect(out.txn.type).toBe("NTU");
    expect(out.txn.ledgerBatchId).toBeNull();

    // Cover never incepted, so the whole commission is unearned, not a share.
    expect(out.clawbackTxn.type).toBe("CMSN-CLAWBACK");
    expect(out.clawbackTxn.parentTxnId).toBe(out.txn.id);
    expect(out.clawbackTxn.grossMinor).toBe(commissionMinor);
    const legs = await balanced(out.clawbackTxn.ledgerBatchId as string);
    expect(legs.debit).toBe(legs.credit);
    expect(legs.credit).toBe(commissionMinor);

    // No premium was collected, so nothing is refunded.
    expect(out.refundTxn).toBeNull();

    // A contract that never started grows no version history.
    const versions = await versionsOf(policyId);
    expect(versions.length).toBe(1);
    expect(versions[0]!.state).toBe("effective");
    expect(versions[0]!.effectiveTo).toBe(start + 365 * DAY);

    expect((await eventsFor(policyId, "axis.policy.ntu")).length).toBe(1);
  });

  it("renewal binds a successor term and closes the prior one", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.renew");
    const start = Date.now() - 360 * DAY;
    const { id: priorId, premiumMinor, commissionMinor } = await boundPolicy("POL-REN-1", start);
    // Only cover that went on risk can be renewed — the state machine refuses
    // `bound -> renewed`, because there is nothing to renew.
    await database
      .update(schema.axisPolicies)
      .set({ status: "active", inceptedAt: start })
      .where(eq(schema.axisPolicies.id, priorId));

    const out = ok(await call("POST", `/v1/axis/policies/${priorId}/renew`, {}), 201);

    // A renewal is a new contract, not an edit: its own head row, its own
    // version 1, pointing back at the term it replaces.
    expect(out.policy.id).not.toBe(priorId);
    expect(out.policy.renewedFromPolicyId).toBe(priorId);
    expect(out.policy.renewalSeq).toBe(1);
    expect(out.policy.policyNo).toBe("POL-REN-1-R1");
    expect(out.policy.status).toBe("bound");
    expect(out.policy.versionSeq).toBe(1);
    // The successor's term starts where the prior one ended, same length.
    const prior = await policyRow(priorId);
    expect(out.policy.startAt).toBe(prior.endAt);
    expect(out.policy.endAt - out.policy.startAt).toBe(365 * DAY);
    expect(out.policy.premiumMinor).toBe(premiumMinor);
    // A new term starts clean: no inception, no scars from the prior one.
    expect(out.policy.inceptedAt).toBeNull();
    expect(out.policy.caseId).toBeNull();

    expect(prior.status).toBe("renewed");

    const versions = await versionsOf(out.policy.id as string);
    expect(versions.length).toBe(1);
    expect(versions[0]!.versionSeq).toBe(1);
    expect(versions[0]!.reason).toBe("issue");
    expect(versions[0]!.state).toBe("effective");
    expect(versions[0]!.premiumDeltaMinor).toBe(0);

    // RENEW accrues next term's commission through a balanced batch.
    expect(out.txn.type).toBe("RENEW");
    const legs = await balanced(out.txn.ledgerBatchId as string);
    expect(legs.legs.length).toBeGreaterThanOrEqual(2);
    expect(legs.debit).toBe(legs.credit);
    expect(legs.debit).toBe(commissionMinor);

    expect((await eventsFor(priorId, "axis.policy.renewed")).length).toBe(1);

    // Asking twice renews once: the key is the term being replaced, so the
    // retry replays rather than minting a second successor.
    const again = ok(await call("POST", `/v1/axis/policies/${priorId}/renew`, {}), 201);
    expect(again.policy.id).toBe(out.policy.id);
  });

  it("the version list is scoped to one policy", async () => {
    await autoApprove("axis.bind", "axis.underwriting_referral", "axis.endorse");
    const start = Date.now() - 20 * DAY;
    const { id: mine } = await boundPolicy("POL-VER-1", start);
    const { id: theirs } = await boundPolicy("POL-VER-2", start);
    ok(
      await call("POST", `/v1/axis/policies/${mine}/endorse`, {
        changes: { excessMinor: 150_000 },
        reason: "excess raised"
      }),
      200,
      201
    );

    const listed = ok(await call("GET", `/v1/axis/policies/${mine}/versions`));
    // The customer's *other* contracts are a different list with the same
    // shape — the bug F5 names is a schedule citing somebody else's version.
    expect(listed.total).toBe(2);
    expect(listed.data.every((v: { policyId: string }) => v.policyId === mine)).toBe(true);
    // Newest first, so the screen's first row is the cover on risk now.
    expect(listed.data.map((v: { versionSeq: number }) => v.versionSeq)).toEqual([2, 1]);

    const other = ok(await call("GET", `/v1/axis/policies/${theirs}/versions`));
    expect(other.total).toBe(1);
    expect(other.data[0]!.policyId).toBe(theirs);
  });
});
