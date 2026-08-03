import { and, eq, sql } from "drizzle-orm";
import { PolicyJson, id, schema, toJson } from "@lyra/db";
import { audit, tooManyRequests, type Ctx } from "@lyra/core";

// docs/02 §5: "Budget metering per tenant/day in a Durable Object counter; hard
// stop + admin alert at 100%."
//
// ponytail: the D1 row is the counter. A DO in front of it is the fast path when
// concurrency makes the read-modify-write contend — the reserve/settle shape here
// is the same either way, so that swap is one file.

export const WARN_AT = 0.8;

export interface BudgetState {
  id: string;
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

// Limit semantics: 0 = blocked (a tenant zeroing the budget turns AI off),
// null/undefined = unlimited. Note the schema (ai_budgets.tokens_limit NOT NULL)
// and PolicyJson (nonnegative with a positive default) cannot express unlimited
// today — every row carries a number — so these helpers only ever see numbers,
// but the null branch keeps the semantic in one place if that ever changes.
function overLimit(used: number, limit: number | null | undefined): boolean {
  return limit != null && used >= limit;
}

function usedFraction(used: number, limit: number | null | undefined): number {
  if (limit == null) return 0;
  if (limit === 0) return 1;
  return used / limit;
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
    usedFraction(state.tokensUsed, state.tokensLimit),
    usedFraction(state.costMicroUsed, state.costMicroLimit)
  );
  const usedPct = Math.min(100, Math.round(pct * 100));
  const outOfTokens = overLimit(state.tokensUsed, state.tokensLimit);
  const outOfCost = overLimit(state.costMicroUsed, state.costMicroLimit);
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
    Math.max(usedFraction(t, before.tokensLimit), usedFraction(c, before.costMicroLimit));
  const wasPct = pctOf(before.tokensUsed, before.costMicroUsed);
  const nowPct = pctOf(tokensUsed, costMicroUsed);

  await ctx.db
    .update(schema.aiBudgets)
    .set({
      // Relative update: another request may have charged between our read and write.
      tokensUsed: sql`${schema.aiBudgets.tokensUsed} + ${tokens}`,
      costMicroUsed: sql`${schema.aiBudgets.costMicroUsed} + ${usage.costMicro}`,
      // The latch is decided from the post-increment values inside this one
      // statement — deciding it from `before` re-introduces the race where N
      // concurrent charges all read under-limit, none latch, and one writes the
      // stale null back over another's stop.
      stoppedAt: sql`CASE
        WHEN ${schema.aiBudgets.stoppedAt} IS NOT NULL THEN ${schema.aiBudgets.stoppedAt}
        WHEN ${schema.aiBudgets.tokensUsed} + ${tokens} >= ${schema.aiBudgets.tokensLimit}
          OR ${schema.aiBudgets.costMicroUsed} + ${usage.costMicro} >= ${schema.aiBudgets.costMicroLimit}
        THEN ${ctx.now}
        ELSE NULL
      END`,
      updatedAt: ctx.now
    })
    .where(
      and(
        eq(schema.aiBudgets.tenantId, ctx.tenantId),
        eq(schema.aiBudgets.day, before.day),
        eq(schema.aiBudgets.module, module)
      )
    );

  // Re-read so `stopped` reports the latch the statement actually decided,
  // including a stop another concurrent charge pushed the row over.
  const after = await upsertRow(ctx, module);

  return {
    usedPct: Math.min(100, Math.round(nowPct * 100)),
    crossedWarning: wasPct < WARN_AT && nowPct >= WARN_AT,
    stopped: after.stoppedAt !== null
  };
}

/**
 * Admin raise: takes effect immediately and clears the stop. Gated by
 * `ai:budgets:write` + the `ai.budget_raise` approval policy at the route.
 *
 * Two things happen here rather than at the caller, so that every caller gets
 * them and not just `POST /v1/ai/budget/limits`:
 *
 * 1. The audit row (CLAUDE.md §4). Moving a spend ceiling is consequential; the
 *    before/after images are the budget window either side of the change.
 * 2. The write-through to tenant policy. `ai_budgets` rows are per (tenant, day,
 *    module) and `upsertRow` seeds tomorrow's from `ctx.policy`, so a ceiling
 *    that lived only in today's row reverted at the UTC day boundary — silently,
 *    because nothing in the product writes tenant policy. Policy is the durable
 *    home for the ceiling; the row is one day's window onto it.
 */
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
  // Same semantics as checkBudget: a ceiling of 0 keeps the stop (blocked), an
  // unlimited (null) ceiling would clear it, a raise above the spend clears it.
  const clears =
    !overLimit(row.tokensUsed, next.tokensLimit) && !overLimit(row.costMicroUsed, next.costMicroLimit);
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

  // The tenant-wide ceiling is the one policy can express, and it is what both
  // the API and the screen default to (`module` defaults to `*`).
  //
  // ponytail: a per-module ceiling still lapses at midnight — PolicyJson has one
  // pair of budget fields, not a per-module map. Upgrade path: a
  // `aiBudgetByModule` record on PolicyJson (packages/db) once a tenant actually
  // wants a standing per-module cap; today `*` is the standing ceiling and a
  // module cap is a same-day throttle.
  if (module === "*") {
    const policy: PolicyJson = {
      ...ctx.policy,
      aiBudgetDailyTokens: next.tokensLimit,
      aiBudgetDailyCostMicro: next.costMicroLimit
    };
    await ctx.db
      .update(schema.tenants)
      .set({ policyJson: toJson(PolicyJson, policy), updatedAt: ctx.now })
      // core_tenants is scoped by its own id — the row *is* the tenant.
      .where(eq(schema.tenants.id, ctx.tenantId));
    // Later reads in this same request see the ceiling they just moved.
    ctx.policy = policy;
  }

  const after: BudgetState = { ...row, ...next, stoppedAt: clears ? null : row.stoppedAt };
  await audit(ctx, {
    action: "ai.budget.set_limits",
    subjectRef: row.id,
    before: row,
    after
  });
  return after;
}
