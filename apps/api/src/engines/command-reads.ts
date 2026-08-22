import { desc, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { badRequest, require_, scoped, type Ctx } from "@lyra/core";

// ADR-0073. The read half of the unified registry: one handler per read tool,
// each checking the same permission the module's own list route requires, so
// an agent can never read through the registry what its human could not read
// through the UI. Writes live in orbit-tools.ts (unchanged gates) and
// consequential actions never reach this file — the loop proposes them.

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

async function listOpenCases(ctx: Ctx): Promise<unknown> {
  require_(ctx.actor, "axis:cases:read", { tenantId: ctx.tenantId, module: "axis" });
  return ctx.db
    .select()
    .from(schema.axisCases)
    .where(scoped(ctx, schema.axisCases))
    .orderBy(desc(schema.axisCases.updatedAt))
    .limit(20);
}

async function fetchPolicySummary(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const policyId = optStr(args.policyId);
  if (!policyId) throw badRequest("fetch_policy_summary needs policyId");
  require_(ctx.actor, "axis:policies:read", { tenantId: ctx.tenantId, module: "axis" });
  const rows = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policyId)))
    .limit(1);
  return rows[0] ?? null;
}

async function listCampaigns(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  require_(ctx.actor, "signal:campaigns:read", { tenantId: ctx.tenantId, module: "signal" });
  const status = optStr(args.status);
  return ctx.db
    .select()
    .from(schema.signalCampaigns)
    .where(
      scoped(ctx, schema.signalCampaigns, status ? eq(schema.signalCampaigns.state, status) : undefined)
    )
    .orderBy(desc(schema.signalCampaigns.updatedAt))
    .limit(20);
}

async function listWhitespaces(ctx: Ctx): Promise<unknown> {
  require_(ctx.actor, "scout:whitespaces:read", { tenantId: ctx.tenantId, module: "scout" });
  return ctx.db
    .select()
    .from(schema.scoutWhitespaces)
    .where(scoped(ctx, schema.scoutWhitespaces))
    .orderBy(desc(schema.scoutWhitespaces.createdAt))
    .limit(20);
}

async function latestSnapshot(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  require_(ctx.actor, "north:snapshots:read", { tenantId: ctx.tenantId, module: "north" });
  const period = optStr(args.period);
  const rows = await ctx.db
    .select()
    .from(schema.northSnapshots)
    .where(scoped(ctx, schema.northSnapshots, period ? eq(schema.northSnapshots.period, period) : undefined))
    .orderBy(desc(schema.northSnapshots.period))
    .limit(1);
  return rows[0] ?? null;
}

async function accountBalance(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const code = optStr(args.code);
  if (!code) throw badRequest("account_balance needs code");
  require_(ctx.actor, "ledger:accounts:read", { tenantId: ctx.tenantId, module: "ledger" });
  const rows = await ctx.db
    .select()
    .from(schema.ledgerAccountBalances)
    .where(scoped(ctx, schema.ledgerAccountBalances, eq(schema.ledgerAccountBalances.accountCode, code)))
    .limit(1);
  return rows[0] ?? null;
}

const READ_HANDLERS: Record<string, (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>> = {
  list_open_cases: (ctx) => listOpenCases(ctx),
  fetch_policy_summary: fetchPolicySummary,
  list_campaigns: listCampaigns,
  list_whitespaces: (ctx) => listWhitespaces(ctx),
  latest_snapshot: latestSnapshot,
  account_balance: accountBalance
};

export async function runCommandRead(
  ctx: Ctx,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = READ_HANDLERS[name];
  if (!handler) throw badRequest(`no read handler for ${name}`);
  return handler(ctx, args);
}
