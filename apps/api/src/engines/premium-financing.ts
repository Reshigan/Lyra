import { asc, eq, inArray } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { badRequest, conflict, emit, scoped, type Ctx } from "@lyra/core";
import { buildRecipe, fxRateFor, runTxn } from "@lyra/ledger";
import { SWEEP_MAX } from "./sweep.js";

// docs/27 group D — premium financing. Opening a plan itself moves no money
// (PLAN-CREATE is non-financial, docs/19 §4.2); the financing house's
// commission is a real receivable the moment the plan opens, so it posts as a
// chained FIN-CMSN transaction (docs/19 §5.2 A) rather than inside PLAN-CREATE.
//
// Collection is accrual-on-schedule, and non-payment is driven by a real
// signal — a failed `ledger_payments` row keyed `<planId>:<seq>`. See
// docs/decisions/ADR-0066-premium-financing-settlement-signal.md for what that
// means while nothing writes those rows yet.

export type PolicyRow = typeof schema.axisPolicies.$inferSelect;
export type PaymentPlanRow = typeof schema.ledgerPaymentPlans.$inferSelect;

export interface ScheduleRow {
  seq: number;
  dueAt: number;
  amountMinor: number;
  /** `"due"` is the legacy synonym of `"pending"` written by packages/core/src/seed/ledger.ts. */
  state: "pending" | "due" | "paid" | "missed";
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

/** Only a live policy has premium left to finance. */
const FINANCEABLE_POLICY_STATES = ["bound", "active"];

const uncollected = (state: ScheduleRow["state"]): boolean => state === "pending" || state === "due";

/** Legacy plan rows carry a `policy:`-prefixed subjectRef; the ledger dims and
 *  the lapse consumer's policy lookup both need the bare id. */
const policyIdOf = (plan: PaymentPlanRow): string => plan.subjectRef.replace(/^policy:/, "");

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function buildSchedule(input: CreatePlanInput): ScheduleRow[] {
  const perInstalment = Math.round(input.totalMinor / input.instalments);
  return Array.from({ length: input.instalments }, (_, i) => ({
    seq: i + 1,
    dueAt: input.startAt + i * input.frequencyDays * 86_400_000,
    // The last instalment absorbs the rounding remainder, so the schedule sums
    // to exactly totalMinor — otherwise the financier is short-paid or over-paid
    // by up to (instalments - 1) minor units, silently, on every plan.
    amountMinor:
      i === input.instalments - 1
        ? input.totalMinor - perInstalment * (input.instalments - 1)
        : perInstalment,
    state: "pending" as const
  }));
}

export async function createPlan(
  ctx: Ctx,
  policy: PolicyRow,
  input: CreatePlanInput
): Promise<{ plan: PaymentPlanRow; txn: { id: string } }> {
  // A lapsed/cancelled/expired/draft policy has no premium to finance: opening a
  // plan would book a commission receivable and then collect instalments for
  // cover that does not exist.
  if (!FINANCEABLE_POLICY_STATES.includes(policy.status)) {
    throw conflict(`policy ${policy.id} is ${policy.status}; premium financing needs bound or active`);
  }

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
      grossMinor: input.commissionMinor,
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

/**
 * The settlement signal for the instalments being collected this tick, if a
 * PSP/financier intake has written any: `ledger_payments.providerRef =
 * "<planId>:<seq>"` (ADR-0066). One scoped query, latest row per seq wins, so a
 * retry that succeeds supersedes an earlier failure.
 */
async function paymentsBySeq(
  ctx: Ctx,
  refs: string[]
): Promise<Map<string, typeof schema.ledgerPayments.$inferSelect>> {
  const rows = await ctx.db
    .select()
    .from(schema.ledgerPayments)
    .where(scoped(ctx, schema.ledgerPayments, inArray(schema.ledgerPayments.providerRef, refs)))
    .orderBy(asc(schema.ledgerPayments.createdAt));
  return new Map(rows.map((r) => [r.providerRef ?? "", r]));
}

export async function payInstalment(ctx: Ctx, plan: PaymentPlanRow, now: number): Promise<void> {
  const schedule: ScheduleRow[] = JSON.parse(plan.scheduleJson);
  const policyId = policyIdOf(plan);
  const due = schedule.filter((row) => uncollected(row.state) && row.dueAt <= now);

  const previousMissedStreak = plan.missedStreak;
  let missedStreak = plan.missedStreak;
  let changed = false;

  if (due.length > 0) {
    // Pre-check before any row is touched: an unrateable currency is our fault,
    // not the customer's. Leave the whole plan for the next tick rather than
    // manufacturing misses out of an operator's missing rate.
    const fxRatePpm = await fxRateFor(ctx, plan.currency);
    if (!fxRatePpm) {
      console.error("premium-financing: no fx rate, plan left for the next tick", {
        planId: plan.id,
        error: `no fx rate supplied for ${plan.currency} -> ${ctx.policy.currency}`
      });
      return;
    }

    const payments = await paymentsBySeq(
      ctx,
      due.map((row) => `${plan.id}:${row.seq}`)
    );

    for (const row of due) {
      const payment = payments.get(`${plan.id}:${row.seq}`);

      if (payment && (payment.state === "failed" || payment.state === "charged_back")) {
        // The only thing that makes an instalment a miss: money that was
        // actually refused or clawed back.
        row.state = "missed";
        missedStreak += 1;
        changed = true;
        try {
          await runTxn(ctx, {
            type: "DUNNING",
            idempotencyKey: `finance.dunning:${plan.id}:${row.seq}`,
            currency: plan.currency,
            subjectRefs: { policy: policyId, plan: plan.id },
            metadata: {
              seq: row.seq,
              paymentId: payment.id,
              paymentState: payment.state,
              failureCode: payment.failureCode ?? null
            }
          });
        } catch (err) {
          // The dunning record is a note *about* the miss, not the miss itself:
          // failing to write it must not lose the streak that drives lapse.
          console.error("premium-financing: dunning record failed to post", {
            planId: plan.id,
            seq: row.seq,
            error: message(err)
          });
        }
        continue;
      }

      try {
        const lines = buildRecipe("PREM-INSTALMENT", {
          amountMinor: row.amountMinor,
          memo: `instalment ${row.seq}/${plan.instalments}: plan ${plan.id}`,
          dims: { policy: policyId }
        });
        await runTxn(
          ctx,
          {
            type: "PREM-INSTALMENT",
            idempotencyKey: `finance.instalment:${plan.id}:${row.seq}`,
            currency: plan.currency,
            grossMinor: row.amountMinor,
            subjectRefs: { policy: policyId, plan: plan.id }
          },
          { recipe: { lines, currency: plan.currency, fxRatePpm } }
        );
        row.state = "paid";
        // The streak counts *consecutive* misses, so any collection clears it:
        // a plan that pays after two misses starts again from zero rather than
        // lapsing on a miss months later. A collection later in this same tick
        // therefore cancels earlier misses in it — deliberate, and the reason
        // the crossing check below reads the final value, not a running one.
        missedStreak = 0;
        changed = true;
      } catch (err) {
        // Our own posting failure, not a customer default: the row stays
        // pending, the streak is untouched, no DUNNING is recorded, and the next
        // tick retries it under the same idempotency key.
        console.error("premium-financing: instalment failed to post, retrying next tick", {
          planId: plan.id,
          seq: row.seq,
          error: message(err)
        });
      }
    }
  }

  // Fire exactly once: only on the tick where the streak actually crosses the
  // threshold, not on every subsequent tick where it stays at or above it.
  const crossedThreshold =
    previousMissedStreak < DUNNING_LAPSE_THRESHOLD && missedStreak >= DUNNING_LAPSE_THRESHOLD;
  // A finished or defaulted plan has to leave the sweep's result set, or it is
  // re-read every tick forever and crowds newer plans out of the SWEEP_MAX
  // window (ADR-0050: a cap is only safe when a processed row leaves the set).
  const state = crossedThreshold
    ? "defaulted"
    : schedule.every((row) => row.state === "paid")
      ? "completed"
      : plan.state;

  if (!changed && state === plan.state) return; // nothing due, nothing to write

  await ctx.db
    .update(schema.ledgerPaymentPlans)
    .set({ scheduleJson: JSON.stringify(schedule), missedStreak, state, updatedAt: now })
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.id, plan.id)));

  if (crossedThreshold) {
    const missedSeq = [...schedule].reverse().find((row) => row.state === "missed")?.seq ?? 0;
    await emit(ctx, {
      module: "ledger",
      type: "ledger.financing.lapse_due",
      subject: `plan:${plan.id}`,
      data: { policyId, planId: plan.id, missedStreak, missedSeq }
    });
  }
}

export async function sweepPremiumFinancing(ctx: Ctx): Promise<number> {
  const plans = await ctx.db
    .select()
    .from(schema.ledgerPaymentPlans)
    .where(scoped(ctx, schema.ledgerPaymentPlans, eq(schema.ledgerPaymentPlans.state, "active")))
    // ponytail: oldest-first, so the plan waiting longest is collected first if a
    // tenant ever exceeds SWEEP_MAX active plans. Cursor paging when one does.
    .orderBy(asc(schema.ledgerPaymentPlans.createdAt))
    .limit(SWEEP_MAX);

  for (const plan of plans) {
    // One plan's fully-caught failure (fx guard above) must not stop the rest
    // of this tenant's plans, or the rest of the tenant's cron tick.
    try {
      await payInstalment(ctx, plan, ctx.now);
    } catch (err) {
      console.error("premium-financing: sweep failed for plan", { planId: plan.id, error: message(err) });
    }
  }

  return plans.length;
}
