import { eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, fxRateFor, runTxn } from "@lyra/ledger";

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
  financierRef?: string;
  totalMinor: number;
  currency: string;
  instalments: number;
  startAt: number;
  frequencyDays: number;
  commissionMinor: number;
  commissionTaxMinor?: number;
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
