import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson, id as newId, schema } from "@lyra/db";
import { pendingOutbox, type Ctx } from "@lyra/core";
import { createPlan, payInstalment, sweepPremiumFinancing, DUNNING_LAPSE_THRESHOLD, type PolicyRow } from "./engines/premium-financing.js";
import { onFinancingLapseDue } from "./engines/axis-lifecycle.js";

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
    expect(schedule[11].dueAt).toBe(now + 11 * 30 * 86_400_000);

    // PLAN-CREATE itself is non-financial (no lines); the chained FIN-CMSN txn
    // carries the balanced double-entry, so look it up via parentTxnId.
    const child = await ctx.db
      .select()
      .from(schema.ledgerTxns)
      .where(eq(schema.ledgerTxns.parentTxnId, txn.id));
    expect(child).toHaveLength(1);
    const [childTxn] = child;
    expect(childTxn!.type).toBe("FIN-CMSN");

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

    const [after] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const schedule = JSON.parse(after!.scheduleJson);
    expect(schedule[0].state).toBe("paid");
    expect(after!.missedStreak).toBe(0);

    const txns = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, "PREM-INSTALMENT"));
    expect(txns).toHaveLength(1);
  });

  it("posts DUNNING and increments missedStreak when fx rate is missing for the plan currency, without throwing", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    // Force the plan into a currency with no fx rate on file, simulating the
    // guard's target scenario without needing a second seeded currency.
    await ctx.db.update(schema.ledgerPaymentPlans).set({ currency: "JPY" }).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const [jpyPlan] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await expect(payInstalment(ctx, jpyPlan!, ctx.now)).resolves.not.toThrow();

    const [after] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    expect(after!.missedStreak).toBe(1);
    const schedule = JSON.parse(after!.scheduleJson);
    expect(schedule[0].state).toBe("missed");
    const dunning = await ctx.db.select().from(schema.ledgerTxns).where(eq(schema.ledgerTxns.type, "DUNNING"));
    expect(dunning).toHaveLength(1);
  });

  it("emits ledger.financing.lapse_due once missedStreak reaches the threshold", async () => {
    const { ctx, policy } = await seedTenantAndPolicy({ currency: "AED" });
    const { plan } = await createPlan(ctx, policy, {
      totalMinor: 120_000, currency: "AED", instalments: 12,
      startAt: ctx.now, frequencyDays: 30, commissionMinor: 15_000
    });
    await ctx.db.update(schema.ledgerPaymentPlans)
      .set({ currency: "JPY", missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));
    const [row] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await payInstalment(ctx, row!, ctx.now);

    const events = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    expect(events).toHaveLength(1);

    // A second tick where the plan misses again (streak now past the
    // threshold already) must not re-fire the event.
    const [rowAfterFirstMiss] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, plan.id));
    expect(rowAfterFirstMiss!.missedStreak).toBe(DUNNING_LAPSE_THRESHOLD);
    await payInstalment(ctx, rowAfterFirstMiss!, ctx.now + 30 * 86_400_000);

    const eventsAfterSecondTick = await ctx.db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.type, "ledger.financing.lapse_due"));
    expect(eventsAfterSecondTick).toHaveLength(1);
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
      .set({ currency: "JPY", missedStreak: DUNNING_LAPSE_THRESHOLD - 1 })
      .where(eq(schema.ledgerPaymentPlans.id, plan.id));

    await sweepPremiumFinancing(ctx); // this tick's miss crosses the threshold and emits

    const envelope = (await pendingOutbox(ctx.db)).find((e) => e.type === "ledger.financing.lapse_due");
    expect(envelope).toBeDefined();

    await onFinancingLapseDue(ctx, envelope!);

    const [after] = await ctx.db.select().from(schema.axisPolicies).where(eq(schema.axisPolicies.id, policy.id));
    expect(after!.status).toBe("lapsed");
  });
});

describe("sweepPremiumFinancing", () => {
  it("processes every active plan due for collection and does not throw when one plan's currency has no fx rate", async () => {
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
    const [goodAfter] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, good.plan.id));
    const [badAfter] = await ctx.db.select().from(schema.ledgerPaymentPlans).where(eq(schema.ledgerPaymentPlans.id, bad.plan.id));
    expect(JSON.parse(goodAfter!.scheduleJson)[0].state).toBe("paid");
    expect(badAfter!.missedStreak).toBe(1);
  });
});
