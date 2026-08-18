import { eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, emit, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, fxRateFor, runTxn } from "@lyra/ledger";
import { SWEEP_MAX } from "./sweep.js";

// docs/27 group D — premium financing. Opening a plan itself moves no money
// (PLAN-CREATE is non-financial, docs/19 §4.2); the financing house's
// commission is a real receivable the moment the plan opens, so it posts as a
// chained FIN-CMSN transaction (docs/19 §5.2 A) rather than inside PLAN-CREATE.

export type PolicyRow = typeof schema.axisPolicies.$inferSelect;
export type PaymentPlanRow = typeof schema.ledgerPaymentPlans.$inferSelect;

export interface ScheduleRow {
  seq: number;
  dueAt: number;
  amountMinor: number;
  state: "pending" | "paid" | "missed";
}

export interface CreatePlanInput {
  financierRef?: string | undefined;
  totalMinor: number;
  currency: string;
  instalments: number;
  startAt: number;
  frequencyDays: number;
  commissionMinor: number;
  commissionTaxMinor?: number | undefined;
}

/** Three consecutive missed instalments cascade into policy lapse. */
export const DUNNING_LAPSE_THRESHOLD = 3;

function buildSchedule(input: CreatePlanInput): ScheduleRow[] {
  const perInstalment = Math.round(input.totalMinor / input.instalments);
  return Array.from({ length: input.instalments }, (_, i) => ({
    seq: i + 1,
    dueAt: input.startAt + i * input.frequencyDays * 86_400_000,
    amountMinor: perInstalment,
    state: "pending" as const
  }));
}

export async function createPlan(
  ctx: Ctx,
  policy: PolicyRow,
  input: CreatePlanInput
): Promise<{ plan: PaymentPlanRow; txn: { id: string } }> {
  // Pre-check before anything is opened or written: a missing fx rate must
  // not leave a PLAN-CREATE txn opened with no chained commission, or a plan
  // row with a commission that can never post.
  const fxRatePpm = await fxRateFor(ctx, input.currency);
  if (!fxRatePpm) {
    throw badRequest(`no fx rate supplied for ${input.currency} -> ${ctx.policy.currency}`);
  }

  const planId = newId("finplan", ctx.now);
  const schedule = buildSchedule(input);

  const txn = await runTxn(ctx, {
    type: "PLAN-CREATE",
    idempotencyKey: `finance.plan_create:${planId}`,
    currency: input.currency,
    subjectRefs: { policy: policy.id, plan: planId }
  });

  await ctx.db.insert(schema.ledgerPaymentPlans).values({
    id: planId,
    tenantId: ctx.tenantId,
    subjectRef: policy.id,
    financierRef: input.financierRef ?? null,
    totalMinor: input.totalMinor,
    currency: input.currency,
    instalments: input.instalments,
    scheduleJson: JSON.stringify(schedule),
    state: "active",
    missedStreak: 0,
    createdAt: ctx.now,
    updatedAt: ctx.now
  });

  const commissionLines = buildRecipe("FIN-CMSN", {
    grossMinor: input.commissionMinor,
    taxMinor: input.commissionTaxMinor ?? 0,
    memo: `financing commission: plan ${planId}`,
    dims: { policy: policy.id }
  });

  await runTxn(
    ctx,
    {
      type: "FIN-CMSN",
      idempotencyKey: `finance.plan_commission:${planId}`,
      currency: input.currency,
      parentTxnId: txn.id,
      subjectRefs: { policy: policy.id, plan: planId }
    },
    { recipe: { lines: commissionLines, currency: input.currency, fxRatePpm } }
  );

  const [plan] = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.id, planId)));

  return { plan: plan!, txn: { id: txn.id } };
}

export async function payInstalment(ctx: Ctx, plan: PaymentPlanRow, now: number): Promise<void> {
  const schedule: ScheduleRow[] = JSON.parse(plan.scheduleJson);
  const previousMissedStreak = plan.missedStreak;
  let missedStreak = plan.missedStreak;

  for (const row of schedule) {
    if (row.state !== "pending" || row.dueAt > now) continue;

    try {
      const fxRatePpm = await fxRateFor(ctx, plan.currency);
      if (!fxRatePpm) throw badRequest(`no fx rate supplied for ${plan.currency} -> ${ctx.policy.currency}`);

      const lines = buildRecipe("PREM-INSTALMENT", {
        amountMinor: row.amountMinor,
        memo: `instalment ${row.seq}/${plan.instalments}: plan ${plan.id}`,
        dims: { policy: plan.subjectRef }
      });
      await runTxn(
        ctx,
        {
          type: "PREM-INSTALMENT",
          idempotencyKey: `finance.instalment:${plan.id}:${row.seq}`,
          currency: plan.currency,
          subjectRefs: { policy: plan.subjectRef, plan: plan.id }
        },
        { recipe: { lines, currency: plan.currency, fxRatePpm } }
      );
      row.state = "paid";
      missedStreak = 0;
    } catch (err) {
      // A missing fx rate (or any other posting failure) must not throw out of
      // the sweep loop — every other plan in this tenant's tick, and every
      // other cron job after sweepPremiumFinancing, has to keep running.
      row.state = "missed";
      missedStreak += 1;
      await runTxn(ctx, {
        type: "DUNNING",
        idempotencyKey: `finance.dunning:${plan.id}:${row.seq}`,
        currency: plan.currency,
        subjectRefs: { policy: plan.subjectRef, plan: plan.id },
        metadata: { reason: err instanceof Error ? err.message : String(err), seq: row.seq }
      });
    }
  }

  await ctx.db
    .update(schema.ledgerPaymentPlans)
    .set({ scheduleJson: JSON.stringify(schedule), missedStreak, updatedAt: now })
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.id, plan.id)));

  // Fire exactly once: only on the tick where the streak actually crosses the
  // threshold, not on every subsequent tick where it stays at or above it.
  if (previousMissedStreak < DUNNING_LAPSE_THRESHOLD && missedStreak >= DUNNING_LAPSE_THRESHOLD) {
    const missedSeq = [...schedule].reverse().find((r) => r.state === "missed")?.seq ?? 0;
    await emit(ctx, {
      module: "ledger",
      type: "ledger.financing.lapse_due",
      subject: `plan:${plan.id}`,
      data: { policyId: plan.subjectRef, planId: plan.id, missedStreak, missedSeq }
    });
  }
}

export async function sweepPremiumFinancing(ctx: Ctx): Promise<number> {
  const plans = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.state, "active")))
    .limit(SWEEP_MAX);

  for (const plan of plans) {
    // One plan's fully-caught failure (fx guard above) must not stop the rest
    // of this tenant's plans, or the rest of the tenant's cron tick.
    try {
      await payInstalment(ctx, plan, ctx.now);
    } catch (err) {
      console.error("premium-financing: sweep failed for plan", { planId: plan.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return plans.length;
}
