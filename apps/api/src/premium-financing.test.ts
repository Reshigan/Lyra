import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, id as newId, schema } from "@lyra/db";
import { notFound, pendingOutbox, type Ctx } from "@lyra/core";
import {
  createPlan,
  payInstalment,
  sweepPremiumFinancing,
  DUNNING_LAPSE_THRESHOLD,
  type PaymentPlanRow,
  type PolicyRow
} from "./engines/premium-financing.js";
import { onFinancingLapseDue } from "./engines/axis-lifecycle.js";
import { axisRoutes } from "./routes/axis.js";
import { crudRouter } from "./crud.js";
import { BY_MODULE } from "./resources.js";
import { onError } from "./mw.js";
import type { App } from "./env.js";

// docs/27 group D — premium financing createPlan(). Flat/local-helper
// convention (no shared fixtures export seedTenantAndPolicy/testCtx in this
// codebase state — modeled on packages/ledger/src/posting.test.ts's testCtx
// and apps/api/src/engines/axis-fnol.test.ts's direct-insert seedPolicy).

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function seedTenantAndPolicy(opts: { currency: string }): Promise<{ ctx: Ctx; policy: PolicyRow }> {
  const client = createClient({ url: ":memory:" });
  for (const sql of statements()) await client.execute(sql);
  const tenantId = "t_test";
  const now = Date.UTC(2026, 5, 15, 12);
  const ctx: Ctx = {
    db: drizzle(client) as unknown as Ctx["db"],
    tenantId,
    actor: { kind: "user", id: "u_test", tenantId, grants: [{ roleKey: "owner", permissions: ["*:*:*"] }] },
    requestId: "req_test",
    now,
    locale: "en",
    policy: PolicyJson.parse({ currency: opts.currency }),
    entitlements: EntitlementsJson.parse({})
  };

  const policyId = newId("pol", now);
  const startAt = now - 30 * 86_400_000;
  const endAt = now + 335 * 86_400_000;
  await ctx.db.insert(schema.axisPolicies).values({
    id: policyId,
    tenantId,
    customerId: `cust_${policyId}`,
    providerId: "prov_test",
    policyNo: `POL-${policyId}`,
    versionSeq: 1,
    startAt,
    endAt,
    premiumMinor: 100_000,
    currency: opts.currency,
    status: "active",
    createdAt: now,
    updatedAt: now
  } as never);

  const [policy] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policyId));
  return { ctx, policy: policy! };
}

/**
 * A minimal router with a fixed ctx, mirroring resources.test.ts's `router()`
 * helper — the full `app` from ./index.js authenticates over a real session
 * (axis-lifecycle.test.ts's login flow), which this file's flat convention
 * has no fixture for. Mounting the real axisRoutes and the real
 * ledger/payment-plans resource under their real paths, with ctx injected
 * directly, exercises the actual route/permission wiring without the login
 * detour.
 */
function testApp(ctx: Ctx): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.notFound((c) => onError(notFound(c.req.path), c));
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/v1/axis", axisRoutes);
  const paymentPlans = BY_MODULE.ledger?.find((r) => r.path === "payment-plans");
  if (!paymentPlans) throw new Error("no ledger/payment-plans resource");
  app.route("/v1/ledger/payment-plans", crudRouter(paymentPlans));
  return app;
}

const DAY = 86_400_000;

/**
 * The non-payment signal (ADR-0066): a `ledger_payments` row scoped to the
 * instalment by `providerRef = "<planId>:<seq>"`. Nothing in production writes
 * these yet — a PSP/financier settlement intake is the follow-up work — so the
 * tests are the seam's only writer today.
 */
async function insertPayment(ctx: Ctx, planId: string, seq: number, state: string): Promise<void> {
  await ctx.db.insert(schema.ledgerPayments).values({
    id: newId("pay", ctx.now + seq),
    tenantId: ctx.tenantId,
    direction: "in",
    method: "bank",
    providerRef: `${planId}:${seq}`,
    amountMinor: 10_000,
    currency: "AED",
    state,
    failureCode: state === "failed" ? "insufficient_funds" : null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  } as never);
}

async function reread(ctx: Ctx, planId: string): Promise<PaymentPlanRow> {
  const [row] = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(eq(schema.ledgerPaymentPlans.id, planId));
  return row!;
}

const txnsOfType = (ctx: Ctx, type: string) =>
  ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, type));

describe("createPlan", () => {
  it("opens a non-financial PLAN-CREATE txn, chains a balanced FIN-CMSN commission, and stores the schedule", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const now = ctx.now;

    const { plan, txn } = await createPlan(ctx, policy, {
      totalMinor: 120_000,
      currency: "AED",
      instalments: 12,
      startAt: now,
      frequencyDays: 30,
      commissionMinor: 15_000,
      commissionTaxMinor: 700
    });

    expect(plan.subjectRef).toBe(policy.id);
    expect(plan.totalMinor).toBe(120_000);
    expect(plan.state).toBe("active");
    expect(plan.missedStreak).toBe(0);
    const schedule = JSON.parse(plan.scheduleJson);
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toEqual({ seq: 1, dueAt: now, amountMinor: 10_000, state: "pending" });
    expect(schedule[11].dueAt).toBe(now + 11 * 30 * DAY);

    // PLAN-CREATE itself is non-financial (no lines); the chained FIN-CMSN txn
    // carries the balanced double-entry, so look it up via parentTxnId.
    const child = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(eq(schema.ledgerTxns.parentTxnId, txn.id));
    expect(child).toHaveLength(1);
    const [childTxn] = child;
    expect(childTxn!.type).toBe("FIN-CMSN");
    // The txn header's own gross, not just the posted batch's base total —
    // every sibling engine stamps it and txn-level reports read it.
    expect(childTxn!.grossMinor).toBe(15_000);

    const childLines = await ctx.db
      .select()
      .from(schema.ledgerJournalLines)
      .where(eq(schema.ledgerJournalLines.txnId, childTxn!.id));
    const byAccount = Object.fromEntries(
      childLines.map((l) => [l.accountCode, { side: l.side, amountMinor: l.amountMinor }])
    );
    expect(byAccount["1150"]).toEqual({ side: "debit", amountMinor: 15_000 });
    expect(byAccount["4080"]).toEqual({ side: "credit", amountMinor: 14_300 });
    expect(byAccount["2200"]).toEqual({ side: "credit", amountMinor: 700 });
  });

  it("gives the last instalment the rounding remainder so the schedule sums to totalMinor", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 10_000, currency: "AED", instalments: 3,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 1_000
    });
    const schedule: { amountMinor: number }[] = JSON.parse(plan.scheduleJson);
    expect(schedule.map((r) => r.amountMinor)).toEqual([3_333, 3_333, 3_334]);
    expect(schedule.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(10_000);
  });

  it("throws badRequest when the plan currency has no fx rate to the tenant base currency", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    // badRequest()'s Error.message is the fixed literal "Bad request" (docs/04
    // §1 problem+json); the reason lives on `.detail` — see apps/api/src/
    // analytics.test.ts for the same assertion shape.
    let error: unknown;
    try {
      await createPlan(ctx, policy, {
        totalMinor: 120_000,
        currency: "JPY",
        instalments: 12,
        startAt: ctx.now,
        frequencyDays: 30,
        commissionMinor: 15_000
      });
    } catch (e) {
      error = e;
    }
    expect((error as { detail?: string } | undefined)?.detail).toMatch(/fx rate/i);
    // The point of the pre-check is that the refusal leaves *no trace*: without
    // it, posting.ts throws the same message from inside the FIN-CMSN post and
    // an `active` plan row with an unpostable commission survives the call.
    expect(await ctx.db.select().from(schema.ledgerPaymentPlans)).toHaveLength(0);
    expect(await txnsOfType(ctx, "PLAN-CREATE")).toHaveLength(0);
  });

  it("refuses a policy that is neither bound nor active", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const cancelled = { ...policy, status: "cancelled" } as PolicyRow;

    await expect(
      createPlan(ctx, cancelled, {
        totalMinor: 120_000, currency: "AED", instalments: 12,
        startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(await ctx.db.select().from(schema.ledgerPaymentPlans)).toHaveLength(0);
    expect(await txnsOfType(ctx, "FIN-CMSN")).toHaveLength(0);
  });
});

describe("payInstalment", () => {
  it("collects a due instalment via PREM-INSTALMENT and marks the row paid", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });

    await payInstalment(ctx, plan, ctx.now);

    const after = await reread(ctx, plan.id);
    const schedule = JSON.parse(after.scheduleJson);
    expect(schedule[0].state).toBe("paid");
    expect(after.missedStreak).toBe(0);
    expect(after.state).toBe("active"); // 11 instalments still to run

    const txns = await txnsOfType(ctx, "PREM-INSTALMENT");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.grossMinor).toBe(10_000);
  });

  it("leaves the row pending with the streak untouched when the fx rate is missing, and collects it on a later tick once the rate is loaded", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    // Force the plan into a currency with no fx rate on file: our inability to
    // rate the posting is an internal fault, not the customer failing to pay.
    await ctx.db.update(schema.ledgerPaymentPlans).set({ currency: "JPY" }).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const jpyPlan = await reread(ctx, plan.id);

    await expect(payInstalment(ctx, jpyPlan, ctx.now)).resolves.toBeUndefined();

    const after = await reread(ctx, plan.id);
    expect(after.missedStreak).toBe(0);
    expect(after.state).toBe("active");
    expect(JSON.parse(after.scheduleJson)[0].state).toBe("pending");
    expect(await txnsOfType(ctx, "DUNNING")).toHaveLength(0);
    expect(await txnsOfType(ctx, "PREM-INSTALMENT")).toHaveLength(0);
    expect(after.updatedAt).toBe(plan.updatedAt); // nothing written at all

    // The operator loads the JPY rate an hour later; the next tick collects it.
    await ctx.db.insert(schema.ledgerFxRates).values({
      id: newId("fx", ctx.now), tenantId: ctx.tenantId,
      fromCurrency: "JPY", toCurrency: "AED", ratePpm: 10_000, asOf: "2026-06-15", source: "manual"
    } as never);

    await payInstalment(ctx, after, ctx.now + 3_600_000);

    const collected = await reread(ctx, plan.id);
    expect(JSON.parse(collected.scheduleJson)[0].state).toBe("paid");
    expect(await txnsOfType(ctx, "PREM-INSTALMENT")).toHaveLength(1);
  });

  it.each(["failed", "charged_back"])("marks the instalment missed and posts DUNNING on a %s payment", async (paymentState) => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await insertPayment(ctx, plan.id, 1, paymentState);

    await payInstalment(ctx, plan, ctx.now);

    const after = await reread(ctx, plan.id);
    expect(after.missedStreak).toBe(1);
    expect(JSON.parse(after.scheduleJson)[0].state).toBe("missed");
    const dunning = await txnsOfType(ctx, "DUNNING");
    expect(dunning).toHaveLength(1);
    expect(JSON.parse(dunning[0]!.metadataJson!)).toMatchObject({ seq: 1, paymentState });
    // No client-money receipt for money that did not arrive.
    expect(await txnsOfType(ctx, "PREM-INSTALMENT")).toHaveLength(0);
  });

  it("persists the miss even when the DUNNING record itself cannot post", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    // A prior DUNNING for this seq is already `failed`, so runTxn's replay
    // guard raises conflict("… already failed") on the second attempt.
    await ctx.db.insert(schema.ledgerTxns).values({
      id: newId("txn", ctx.now), tenantId: ctx.tenantId, type: "DUNNING",
      idempotencyKey: `finance.dunning:${plan.id}:1`, state: "failed",
      actorKind: "system", actorId: "sys", currency: "AED", baseCurrency: "AED",
      createdAt: ctx.now, updatedAt: ctx.now
    } as never);
    await insertPayment(ctx, plan.id, 1, "failed");

    await expect(payInstalment(ctx, plan, ctx.now)).resolves.toBeUndefined();

    const after = await reread(ctx, plan.id);
    expect(after.missedStreak).toBe(1);
    expect(JSON.parse(after.scheduleJson)[0].state).toBe("missed");
  });

  it("marks the plan completed once every instalment is paid, so the sweep stops seeing it", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 20_000, currency: "AED", instalments: 2,
      startAt: ctx.now - 30 * DAY, frequencyDays: 30, commissionMinor: 2_000
    });

    await payInstalment(ctx, plan, ctx.now);

    const after = await reread(ctx, plan.id);
    expect(JSON.parse(after.scheduleJson).map((r: { state: string }) => r.state)).toEqual(["paid", "paid"]);
    expect(after.state).toBe("completed");
  });

  it('collects a legacy-shaped schedule row (state "due", prefixed subjectRef)', async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 20_000, currency: "AED", instalments: 2,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 2_000
    });
    // The vocabulary written by packages/core/src/seed/ledger.ts and by the
    // formerly-writable payment-plans CRUD: "due" instead of "pending", and a
    // `policy:`-prefixed subjectRef.
    const legacy = (JSON.parse(plan.scheduleJson) as { state: string }[]).map((r, i) => (i === 0 ? { ...r, state: "due" } : r));
    await ctx.db
      .update(schema.ledgerPaymentPlans)
      .set({ scheduleJson: JSON.stringify(legacy), subjectRef: `policy:${policy.id}` })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const legacyPlan = await reread(ctx, plan.id);

    await payInstalment(ctx, legacyPlan, ctx.now);

    const after = await reread(ctx, plan.id);
    expect(JSON.parse(after.scheduleJson)[0].state).toBe("paid");
    const [txn] = await txnsOfType(ctx, "PREM-INSTALMENT");
    // The bare policy id, or onFinancingLapseDue's lookup finds nothing.
    expect(JSON.parse(txn!.subjectRefsJson!).policy).toBe(policy.id);
  });

  it("emits ledger.financing.lapse_due once on the crossing tick and defaults the plan", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    await insertPayment(ctx, plan.id, 1, "failed");

    await payInstalment(ctx, await reread(ctx, plan.id), ctx.now);

    const events = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    expect(events).toHaveLength(1);
    const crossed = await reread(ctx, plan.id);
    expect(crossed.missedStreak).toBe(DUNNING_LAPSE_THRESHOLD);
    expect(crossed.state).toBe("defaulted");

    // A later tick where the plan misses again (streak already past the
    // threshold) must not re-fire. Put the plan back in the sweep's set the
    // way an operator reinstating the policy would.
    await ctx.db.update(schema.ledgerPaymentPlans).set({ state: "active" }).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    await insertPayment(ctx, plan.id, 2, "failed");

    await payInstalment(ctx, await reread(ctx, plan.id), ctx.now + 30 * DAY);

    const eventsAfterSecondTick = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    expect(eventsAfterSecondTick).toHaveLength(1);
    expect((await reread(ctx, plan.id)).missedStreak).toBe(DUNNING_LAPSE_THRESHOLD + 1);
  });
});

describe("onFinancingLapseDue", () => {
  it("lapses the policy via the existing lapsePolicy cascade", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    await insertPayment(ctx, plan.id, 1, "failed");

    await sweepPremiumFinancing(ctx); // this tick's miss crosses the threshold and emits

    const envelope = (await pendingOutbox(ctx.db)).find((e) => e.type === "ledger.financing.lapse_due");
    expect(envelope).toBeDefined();

    await onFinancingLapseDue(ctx, envelope!);

    const [after] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policy.id));
    expect(after!.status).toBe("lapsed");
  });

  it("returns quietly when the policy is not active, instead of throwing into six retries and the DLQ", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    await insertPayment(ctx, plan.id, 1, "failed");
    await sweepPremiumFinancing(ctx);
    const envelope = (await pendingOutbox(ctx.db)).find((e) => e.type === "ledger.financing.lapse_due");

    // POLICY_TRANSITIONS allows only active -> lapsed, so anything else would
    // make lapsePolicy's hop() throw conflict and dead-letter the event after
    // six pointless retries.
    await ctx.db.update(schema.axisPolicies).set({ status: "cancelled" }).where(eq(schema.axisPolicies.id, policy.id));

    await expect(onFinancingLapseDue(ctx, envelope!)).resolves.toBeUndefined();

    const [after] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policy.id));
    expect(after!.status).toBe("cancelled");
  });
});

describe("sweepPremiumFinancing", () => {
  it("collects every active plan and leaves a plan it cannot rate for the next tick", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const good = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    const bad = await createPlan(ctx, policy, {
      totalMinor: 60_000, currency: "AED", instalments: 6,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 6_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans).set({ currency: "JPY" }).where(eq(schema.ledgerPaymentPlans.id, bad.plan.id));

    const count = await sweepPremiumFinancing(ctx);

    expect(count).toBe(2);
    const goodAfter = await reread(ctx, good.plan.id);
    const badAfter = await reread(ctx, bad.plan.id);
    expect(JSON.parse(goodAfter.scheduleJson)[0].state).toBe("paid");
    expect(badAfter.missedStreak).toBe(0);
    expect(JSON.parse(badAfter.scheduleJson)[0].state).toBe("pending");
  });

  it("does not rewrite a plan with nothing due", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now + 30 * DAY, frequencyDays: 30, commissionMinor: 15_000
    });

    // A tick a day later, still nothing due: no row churn, so `updatedAt` stays
    // a real signal of "when this plan last changed".
    await payInstalment(ctx, plan, ctx.now + DAY);

    expect((await reread(ctx, plan.id)).updatedAt).toBe(plan.updatedAt);
  });

  it("stops sweeping a plan once it is completed", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    await createPlan(ctx, policy, {
      totalMinor: 10_000, currency: "AED", instalments: 1,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 1_000
    });

    expect(await sweepPremiumFinancing(ctx)).toBe(1);
    expect(await sweepPremiumFinancing(ctx)).toBe(0);
  });
});

describe("POST /v1/axis/policies/:id/premium-financing-plan", () => {
  const planBody = (now: number) => ({
    totalMinor: 120_000, currency: "AED", instalments: 12,
    startAt: now, frequencyDays: 30, commissionMinor: 15_000
  });

  it("creates a plan and is idempotent under a repeated idempotency key", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const app = testApp(ctx);
    const body = planBody(ctx.now);
    const key = "idem-plan-1";

    const first = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { plan: { id: string } };

    const second = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const secondJson = (await second.json()) as { plan: { id: string } };
    expect(secondJson.plan.id).toBe(firstJson.plan.id);

    const plans = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.subjectRef, policy.id));
    expect(plans).toHaveLength(1); // not 2 — the replay didn't insert a second row
  });

  it("is idempotent with no idempotency-key header — the policy is the key", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const app = testApp(ctx);
    const body = planBody(ctx.now);
    const post = () =>
      app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

    const first = (await (await post()).json()) as { plan: { id: string } };
    const second = (await (await post()).json()) as { plan: { id: string } };

    expect(second.plan.id).toBe(first.plan.id);
    // Two plans on one policy would double-count the FIN-CMSN commission and
    // post a duplicate client-money receipt every tick for the plan's life.
    expect(await ctx.db.select().from(schema.ledgerPaymentPlans)).toHaveLength(1);
    expect(await txnsOfType(ctx, "FIN-CMSN")).toHaveLength(1);
  });

  it("rejects a malformed body with a clean 400 instead of reaching createPlan", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const app = testApp(ctx);
    const res = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ totalMinor: 120_000, currency: "AED", instalments: 0, startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000 })
    });
    expect(res.status).toBe(400);
  });

  it("refuses a policy that is neither bound nor active with a 409", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    await ctx.db.update(schema.axisPolicies).set({ status: "draft" }).where(eq(schema.axisPolicies.id, policy.id));
    const app = testApp(ctx);

    const res = await app.request(`/v1/axis/policies/${policy.id}/premium-financing-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(planBody(ctx.now))
    });

    expect(res.status).toBe(409);
    expect(await ctx.db.select().from(schema.ledgerPaymentPlans)).toHaveLength(0);
  });
});

describe("payment-plans resource route (regression)", () => {
  it("rejects a direct create against the generic CRUD route", async () => {
    const { ctx } = await seedTenantAndPolicy({ currency: "AED" });
    const app = testApp(ctx);
    const res = await app.request("/v1/ledger/payment-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "pol_x", totalMinor: 1000, currency: "AED", instalments: 1, scheduleJson: "[]" })
    });
    // ro() declares no `create` permission, so crud.ts never registers the
    // POST route at all — it falls through to app.notFound (404), exactly
    // like the sibling ledger/payments and ledger/txns resources
    // (resources.test.ts "POST /txns and POST /payments do not exist as
    // routes"). Not 403 — deviation from the brief's literal snippet, but
    // matching this codebase's own established, tested convention for ro().
    expect(res.status).toBe(404);
  });
});
