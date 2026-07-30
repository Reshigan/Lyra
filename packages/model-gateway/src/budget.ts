import { and, eq, sql } from "drizzle-orm";
import { id, schema } from "@lyra/db";
import { tooManyRequests, type Ctx } from "@lyra/core";

// docs/02 §5: "Budget metering per tenant/day in a Durable Object counter; hard
// stop + admin alert at 100%."
//
// ponytail: the D1 row is the counter. A DO in front of it is the fast path when
// concurrency makes the read-modify-write contend — the reserve/settle shape here
// is the same either way, so that swap is one file.

export const WARN_AT = 0.8;

export interface BudgetState {
  day: string;
  module: string;
  tokensUsed: number;
  costMicroUsed: number;
  tokensLimit: number;
  costMicroLimit: number;
  stoppedAt: number | null;
}

/** UTC day, so a tenant's budget window does not shift with a timezone change. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function upsertRow(ctx: Ctx, module: string): Promise<BudgetState> {
  const day = dayKey(ctx.now);
  const where = and(
    eq(schema.aiBudgets.tenantId, ctx.tenantId),
    eq(schema.aiBudgets.day, day),
    eq(schema.aiBudgets.module, module)
  );
  const found = await ctx.db.select().from(schema.aiBudgets).where(where).limit(1);
  const row = found[0];
  if (row) return row as BudgetState;

  const fresh = {
    id: id("bdg", ctx.now),
    tenantId: ctx.tenantId,
    day,
    module,
    tokensUsed: 0,
    costMicroUsed: 0,
    tokensLimit: ctx.policy.aiBudgetDailyTokens,
    costMicroLimit: ctx.policy.aiBudgetDailyCostMicro,
    thresholdNotifiedAt: null,
    stoppedAt: null,
    updatedAt: ctx.now
  };
  // Two requests can race here; the unique index makes the loser retry the read.
  try {
    await ctx.db.insert(schema.aiBudgets).values(fresh);
    return fresh as BudgetState;
  } catch {
    const again = await ctx.db.select().from(schema.aiBudgets).where(where).limit(1);
    if (!again[0]) throw new Error("budget row lost a race and did not reappear");
    return again[0] as BudgetState;
  }
}

export interface BudgetCheck {
  ok: boolean;
  state: BudgetState;
  /** 0-100, for the BudgetMeter. */
  usedPct: number;
  reason?: "tokens" | "cost";
}

/**
 * Budget is checked before the call and charged after it, because the true cost
 * is only known once the provider answers. A tenant can therefore overshoot by
 * at most one call — deliberate, and cheaper than reserving worst-case tokens.
 */
export async function checkBudget(ctx: Ctx, module = "*"): Promise<BudgetCheck> {
  const state = await upsertRow(ctx, module);
  const pct = Math.max(
    state.tokensLimit ? state.tokensUsed / state.tokensLimit : 0,
    state.costMicroLimit ? state.costMicroUsed / state.costMicroLimit : 0
  );
  const usedPct = Math.min(100, Math.round(pct * 100));
  const outOfTokens = state.tokensLimit > 0 && state.tokensUsed >= state.tokensLimit;
  const outOfCost = state.costMicroLimit > 0 && state.costMicroUsed >= state.costMicroLimit;
  if (state.stoppedAt || outOfTokens || outOfCost) {
    return { ok: false, state, usedPct, reason: outOfTokens ? "tokens" : "cost" };
  }
  return { ok: true, state, usedPct };
}

/** Throws 429 with a retry-after to the next UTC midnight when the budget is spent. */
export async function assertBudget(ctx: Ctx, module = "*"): Promise<BudgetCheck> {
  const check = await checkBudget(ctx, module);
  if (!check.ok) {
    const midnight = Date.UTC(
      new Date(ctx.now).getUTCFullYear(),
      new Date(ctx.now).getUTCMonth(),
      new Date(ctx.now).getUTCDate() + 1
    );
    throw tooManyRequests(Math.max(1, Math.ceil((midnight - ctx.now) / 1000)));
  }
  return check;
}

export interface ChargeResult {
  usedPct: number;
  /** Crossed WARN_AT on this call — the caller notifies the admin once. */
  crossedWarning: boolean;
  stopped: boolean;
}

/** Charge actual usage. Called on every completion, including failed ones that burned tokens. */
export async function charge(
  ctx: Ctx,
  usage: { tokensIn: number; tokensOut: number; costMicro: number },
  module = "*"
): Promise<ChargeResult> {
  const before = await upsertRow(ctx, module);
  const tokens = usage.tokensIn + usage.tokensOut;
  const tokensUsed = before.tokensUsed + tokens;
  const costMicroUsed = before.costMicroUsed + usage.costMicro;

  const pctOf = (t: number, c: number) =>
    Math.max(
      before.tokensLimit ? t / before.tokensLimit : 0,
      before.costMicroLimit ? c / before.costMicroLimit : 0
    );
  const wasPct = pctOf(before.tokensUsed, before.costMicroUsed);
  const nowPct = pctOf(tokensUsed, costMicroUsed);
  const stopped = nowPct >= 1;

  await ctx.db
    .update(schema.aiBudgets)
    .set({
      // Relative update: another request may have charged between our read and write.
      tokensUsed: sql`${schema.aiBudgets.tokensUsed} + ${tokens}`,
      costMicroUsed: sql`${schema.aiBudgets.costMicroUsed} + ${usage.costMicro}`,
      stoppedAt: stopped ? (before.stoppedAt ?? ctx.now) : before.stoppedAt,
      updatedAt: ctx.now
    })
    .where(
      and(
        eq(schema.aiBudgets.tenantId, ctx.tenantId),
        eq(schema.aiBudgets.day, before.day),
        eq(schema.aiBudgets.module, module)
      )
    );

  return {
    usedPct: Math.min(100, Math.round(nowPct * 100)),
    crossedWarning: wasPct < WARN_AT && nowPct >= WARN_AT,
    stopped
  };
}

/** Admin raise: takes effect immediately and clears the stop. Gated by ai.budget_raise. */
export async function setLimits(
  ctx: Ctx,
  limits: { tokensLimit?: number | undefined; costMicroLimit?: number | undefined },
  module = "*"
): Promise<BudgetState> {
  const row = await upsertRow(ctx, module);
  const next = {
    tokensLimit: limits.tokensLimit ?? row.tokensLimit,
    costMicroLimit: limits.costMicroLimit ?? row.costMicroLimit
  };
  const clears = row.tokensUsed < next.tokensLimit && row.costMicroUsed < next.costMicroLimit;
  await ctx.db
    .update(schema.aiBudgets)
    .set({ ...next, stoppedAt: clears ? null : row.stoppedAt, updatedAt: ctx.now })
    .where(
      and(
        eq(schema.aiBudgets.tenantId, ctx.tenantId),
        eq(schema.aiBudgets.day, row.day),
        eq(schema.aiBudgets.module, module)
      )
    );
  return { ...row, ...next, stoppedAt: clears ? null : row.stoppedAt };
}
