import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, lt, ne, notInArray, sql } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { earnedBetween, emit, type Ctx } from "@lyra/core";

// docs/modules/north.md §2.2/§3 — Snapshotter (nightly) + Anomaly Hunter
// (post-snapshot). ADR-0024: a typed compute function per metric, not a
// generic executor over `north_metrics.definition_sql_ref` (that field is
// documentation-only shorthand, not parseable SQL).

const DAY_MS = 86_400_000;
/** Money metrics store minor units; ai_audit_log.cost_micro is 1e-6 of a major unit. */
const MICRO_PER_MINOR = 10_000;

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
function utcMonth(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

interface Period {
  grain: "day" | "month";
  /** YYYY-MM-DD or YYYY-MM */
  period: string;
  since: number;
  until: number;
}

/** Yesterday (closed) as a day period, and the current month-to-date, per seed.ts's stated timing model. */
function periodsFor(now: number): Period[] {
  const yesterdayStart = Math.floor(now / DAY_MS) * DAY_MS - DAY_MS;
  const monthStart = new Date(new Date(now).toISOString().slice(0, 7) + "-01T00:00:00.000Z").getTime();
  return [
    { grain: "day", period: utcDay(yesterdayStart), since: yesterdayStart, until: yesterdayStart + DAY_MS },
    { grain: "month", period: utcMonth(now), since: monthStart, until: now }
  ];
}

type Compute = (ctx: Ctx, p: Period) => Promise<number | null>;

async function countPolicies(ctx: Ctx, p: Period): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.axisPolicies)
    .where(
      and(eq(schema.axisPolicies.tenantId, ctx.tenantId), gte(schema.axisPolicies.createdAt, p.since), lt(schema.axisPolicies.createdAt, p.until))
    );
  return row?.n ?? 0;
}

const policiesIssued: Compute = async (ctx, p) => (p.grain === "day" ? countPolicies(ctx, p) : null);

const quoteToBindRate: Compute = async (ctx, p) => {
  const [issued, [completedReq]] = await Promise.all([
    countPolicies(ctx, p),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.distQuoteRequests)
      .where(
        and(
          eq(schema.distQuoteRequests.tenantId, ctx.tenantId),
          eq(schema.distQuoteRequests.state, "complete"),
          gte(schema.distQuoteRequests.createdAt, p.since),
          lt(schema.distQuoteRequests.createdAt, p.until)
        )
      )
  ]);
  const denom = completedReq?.n ?? 0;
  return denom > 0 ? Math.round((issued / denom) * 10_000) : null;
};

const panelResponseRate: Compute = async (ctx, p) => {
  const [row] = await ctx.db
    .select({
      responded: sql<number>`coalesce(sum(${schema.distQuoteRequests.respondedCount}), 0)`,
      fanout: sql<number>`coalesce(sum(${schema.distQuoteRequests.fanoutCount}), 0)`
    })
    .from(schema.distQuoteRequests)
    .where(
      and(eq(schema.distQuoteRequests.tenantId, ctx.tenantId), gte(schema.distQuoteRequests.createdAt, p.since), lt(schema.distQuoteRequests.createdAt, p.until))
    );
  const fanout = row?.fanout ?? 0;
  return fanout > 0 ? Math.round(((row?.responded ?? 0) / fanout) * 10_000) : null;
};

/** ponytail: p95 via ORDER BY + LIMIT/OFFSET — fine at this volume, revisit if a tenant's daily quote-response count gets huge. */
const quoteLatencyP95: Compute = async (ctx, p) => {
  const rows = await ctx.db
    .select({ latencyMs: schema.distQuoteResponses.latencyMs })
    .from(schema.distQuoteResponses)
    .where(
      and(
        eq(schema.distQuoteResponses.tenantId, ctx.tenantId),
        isNotNull(schema.distQuoteResponses.latencyMs),
        gte(schema.distQuoteResponses.createdAt, p.since),
        lt(schema.distQuoteResponses.createdAt, p.until)
      )
    )
    .orderBy(schema.distQuoteResponses.latencyMs);
  if (!rows.length) return null;
  const idx = Math.min(rows.length - 1, Math.ceil(rows.length * 0.95) - 1);
  return rows[idx]!.latencyMs as number;
};

const gwp: Compute = async (ctx, p) => {
  const [row] = await ctx.db
    .select({ v: sql<number>`coalesce(sum(${schema.axisPolicies.premiumMinor}), 0)` })
    .from(schema.axisPolicies)
    .where(
      and(eq(schema.axisPolicies.tenantId, ctx.tenantId), gte(schema.axisPolicies.createdAt, p.since), lt(schema.axisPolicies.createdAt, p.until))
    );
  return row?.v ?? 0;
};

const netCommission: Compute = async (ctx, p) => {
  const [row] = await ctx.db
    .select({ v: sql<number>`coalesce(sum(${schema.axisPolicies.commissionMinor}), 0)` })
    .from(schema.axisPolicies)
    .where(
      and(eq(schema.axisPolicies.tenantId, ctx.tenantId), gte(schema.axisPolicies.createdAt, p.since), lt(schema.axisPolicies.createdAt, p.until))
    );
  return row?.v ?? 0;
};

/** Point-in-time gauge: "as of now", not scoped to the period window. */
const activePolicies: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.axisPolicies)
    .where(and(eq(schema.axisPolicies.tenantId, ctx.tenantId), eq(schema.axisPolicies.status, "active")));
  return row?.n ?? 0;
};

const cacPerPolicy: Compute = async (ctx, p) => {
  const [spend, issued] = await Promise.all([
    ctx.db
      .select({ v: sql<number>`coalesce(sum(${schema.signalSpend.amountMinor}), 0)` })
      .from(schema.signalSpend)
      .where(and(eq(schema.signalSpend.tenantId, ctx.tenantId), gte(schema.signalSpend.ts, p.since), lt(schema.signalSpend.ts, p.until)))
      .then((r) => r[0]?.v ?? 0),
    countPolicies(ctx, p)
  ]);
  return issued > 0 ? Math.round(spend / issued) : null;
};

const brokerChannelShare: Compute = async (ctx, p) => {
  const rows = await ctx.db
    .select({ premiumMinor: schema.axisPolicies.premiumMinor, channelId: schema.axisPolicies.channelId })
    .from(schema.axisPolicies)
    .where(
      and(eq(schema.axisPolicies.tenantId, ctx.tenantId), gte(schema.axisPolicies.createdAt, p.since), lt(schema.axisPolicies.createdAt, p.until))
    );
  if (!rows.length) return null;
  const channelIds = [...new Set(rows.map((r) => r.channelId).filter((c): c is string => !!c))];
  const b2bIds = channelIds.length
    ? new Set(
        (
          await ctx.db
            .select({ id: schema.distChannels.id })
            .from(schema.distChannels)
            .where(and(eq(schema.distChannels.tenantId, ctx.tenantId), eq(schema.distChannels.kind, "b2b")))
        ).map((c) => c.id)
      )
    : new Set<string>();
  let total = 0;
  let b2b = 0;
  for (const r of rows) {
    total += r.premiumMinor;
    if (r.channelId && b2bIds.has(r.channelId)) b2b += r.premiumMinor;
  }
  return total > 0 ? Math.round((b2b / total) * 10_000) : null;
};

const aiCostPerCase: Compute = async (ctx, p) => {
  const [costMicro, [caseCount]] = await Promise.all([
    ctx.db
      .select({ v: sql<number>`coalesce(sum(${schema.aiAuditLog.costMicro}), 0)` })
      .from(schema.aiAuditLog)
      .where(and(eq(schema.aiAuditLog.tenantId, ctx.tenantId), gte(schema.aiAuditLog.ts, p.since), lt(schema.aiAuditLog.ts, p.until)))
      .then((r) => r[0]?.v ?? 0),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.axisCases)
      .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), gte(schema.axisCases.createdAt, p.since), lt(schema.axisCases.createdAt, p.until)))
  ]);
  const cases = caseCount?.n ?? 0;
  return cases > 0 ? Math.round(costMicro / MICRO_PER_MINOR / cases) : null;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** docs/specs/gap-axis-design.md §F: earned premium, pro-rata over each overlapping version's term. */
async function earnedPremiumForPeriod(ctx: Ctx, p: Period): Promise<number> {
  const rows = await ctx.db
    .select({
      effectiveFrom: schema.axisPolicyVersions.effectiveFrom,
      effectiveTo: schema.axisPolicyVersions.effectiveTo,
      premiumMinor: schema.axisPolicyVersions.premiumMinor
    })
    .from(schema.axisPolicyVersions)
    .where(
      and(
        eq(schema.axisPolicyVersions.tenantId, ctx.tenantId),
        ne(schema.axisPolicyVersions.state, "voided"),
        lt(schema.axisPolicyVersions.effectiveFrom, p.until),
        gt(schema.axisPolicyVersions.effectiveTo, p.since)
      )
    );
  return rows.reduce((sum, v) => sum + earnedBetween(v, p.since, p.until), 0);
}

const grossWrittenPremium: Compute = async (ctx, p) => {
  const [row] = await ctx.db
    .select({
      v: sql<number>`coalesce(sum(${schema.axisPolicyVersions.premiumMinor} + ${schema.axisPolicyVersions.taxMinor} + ${schema.axisPolicyVersions.feesMinor}), 0)`
    })
    .from(schema.axisPolicyVersions)
    .where(
      and(
        eq(schema.axisPolicyVersions.tenantId, ctx.tenantId),
        ne(schema.axisPolicyVersions.state, "voided"),
        gte(schema.axisPolicyVersions.effectiveFrom, p.since),
        lt(schema.axisPolicyVersions.effectiveFrom, p.until)
      )
    );
  return row?.v ?? 0;
};

const netWrittenPremium: Compute = async (ctx, p) => {
  const [row] = await ctx.db
    .select({ v: sql<number>`coalesce(sum(${schema.axisPolicyVersions.premiumMinor}), 0)` })
    .from(schema.axisPolicyVersions)
    .where(
      and(
        eq(schema.axisPolicyVersions.tenantId, ctx.tenantId),
        ne(schema.axisPolicyVersions.state, "voided"),
        gte(schema.axisPolicyVersions.effectiveFrom, p.since),
        lt(schema.axisPolicyVersions.effectiveFrom, p.until)
      )
    );
  return row?.v ?? 0;
};

const lossRatio: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const [claimsRow, earned] = await Promise.all([
    ctx.db
      .select({
        v: sql<number>`coalesce(sum(${schema.axisClaims.paidMinor} + ${schema.axisClaims.reserveMinor} - ${schema.axisClaims.recoveredMinor}), 0)`
      })
      .from(schema.axisClaims)
      .where(
        and(
          eq(schema.axisClaims.tenantId, ctx.tenantId),
          isNotNull(schema.axisClaims.incidentAt),
          gte(schema.axisClaims.incidentAt, p.since),
          lt(schema.axisClaims.incidentAt, p.until)
        )
      )
      .then((r) => r[0]?.v ?? 0),
    earnedPremiumForPeriod(ctx, p)
  ]);
  return earned > 0 ? Math.round((claimsRow / earned) * 10_000) : null;
};

const expenseRatio: Compute = async (ctx, p) => {
  const [expenseRow, earned] = await Promise.all([
    ctx.db
      .select({
        v: sql<number>`coalesce(sum(case when ${schema.ledgerJournalLines.side} = 'debit' then ${schema.ledgerJournalLines.amountMinor} else -${schema.ledgerJournalLines.amountMinor} end), 0)`
      })
      .from(schema.ledgerJournalLines)
      .where(
        and(
          eq(schema.ledgerJournalLines.tenantId, ctx.tenantId),
          sql`${schema.ledgerJournalLines.accountCode} like '5%'`,
          gte(schema.ledgerJournalLines.postedAt, p.since),
          lt(schema.ledgerJournalLines.postedAt, p.until)
        )
      )
      .then((r) => r[0]?.v ?? 0),
    earnedPremiumForPeriod(ctx, p)
  ]);
  return earned > 0 ? Math.round((expenseRow / earned) * 10_000) : null;
};

/** §F: "computed from the two snapshots, not re-queried" — reads already-written rows, run after loss_ratio/expense_ratio (see sort in runSnapshotter). */
const combinedRatio: Compute = async (ctx, p) => {
  const rows = await ctx.db
    .select({ metricKey: schema.northSnapshots.metricKey, value: schema.northSnapshots.value })
    .from(schema.northSnapshots)
    .where(
      and(
        eq(schema.northSnapshots.tenantId, ctx.tenantId),
        eq(schema.northSnapshots.grain, p.grain),
        eq(schema.northSnapshots.period, p.period),
        eq(schema.northSnapshots.dimsHash, ""),
        inArray(schema.northSnapshots.metricKey, ["loss_ratio", "expense_ratio"])
      )
    );
  const loss = rows.find((r) => r.metricKey === "loss_ratio")?.value;
  const expense = rows.find((r) => r.metricKey === "expense_ratio")?.value;
  return loss !== undefined && expense !== undefined ? loss + expense : null;
};

const renewalRetention: Compute = async (ctx, p) => {
  const [renewed, expiring] = await Promise.all([
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.axisPolicies)
      .where(
        and(
          eq(schema.axisPolicies.tenantId, ctx.tenantId),
          isNotNull(schema.axisPolicies.renewedFromPolicyId),
          gte(schema.axisPolicies.createdAt, p.since),
          lt(schema.axisPolicies.createdAt, p.until)
        )
      )
      .then((r) => r[0]?.n ?? 0),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.axisPolicies)
      .where(
        and(eq(schema.axisPolicies.tenantId, ctx.tenantId), gte(schema.axisPolicies.endAt, p.since), lt(schema.axisPolicies.endAt, p.until))
      )
      .then((r) => r[0]?.n ?? 0)
  ]);
  return expiring > 0 ? Math.round((renewed / expiring) * 10_000) : null;
};

const quoteHitRate: Compute = async (ctx, p) => {
  const [bound, requested] = await Promise.all([
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.ledgerTxns)
      .where(
        and(
          eq(schema.ledgerTxns.tenantId, ctx.tenantId),
          eq(schema.ledgerTxns.type, "BIND"),
          gte(schema.ledgerTxns.createdAt, p.since),
          lt(schema.ledgerTxns.createdAt, p.until)
        )
      )
      .then((r) => r[0]?.n ?? 0),
    ctx.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.distQuoteRequests)
      .where(
        and(
          eq(schema.distQuoteRequests.tenantId, ctx.tenantId),
          gte(schema.distQuoteRequests.createdAt, p.since),
          lt(schema.distQuoteRequests.createdAt, p.until)
        )
      )
      .then((r) => r[0]?.n ?? 0)
  ]);
  return requested > 0 ? Math.round((bound / requested) * 10_000) : null;
};

const avgHandlingTimeClaims: Compute = async (ctx, p) => {
  const rows = await ctx.db
    .select({ reportedAt: schema.axisClaims.reportedAt, closedAt: schema.axisClaims.closedAt })
    .from(schema.axisClaims)
    .where(
      and(
        eq(schema.axisClaims.tenantId, ctx.tenantId),
        isNotNull(schema.axisClaims.closedAt),
        gte(schema.axisClaims.closedAt, p.since),
        lt(schema.axisClaims.closedAt, p.until)
      )
    );
  return median(rows.map((r) => r.closedAt! - r.reportedAt));
};

const avgHandlingTimeCases: Compute = async (ctx, p) => {
  const rows = await ctx.db
    .select({ createdAt: schema.axisCases.createdAt, closedAt: schema.axisCases.closedAt })
    .from(schema.axisCases)
    .where(
      and(
        eq(schema.axisCases.tenantId, ctx.tenantId),
        isNotNull(schema.axisCases.closedAt),
        gte(schema.axisCases.closedAt, p.since),
        lt(schema.axisCases.closedAt, p.until)
      )
    );
  return median(rows.map((r) => r.closedAt! - r.createdAt));
};

/** ponytail: one reserve-history lookup per closed claim (N+1) — fine at nightly-snapshot volumes, revisit if a tenant closes thousands of claims a day. */
const reserveAdequacy: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const claims = await ctx.db
    .select({ id: schema.axisClaims.id, reportedAt: schema.axisClaims.reportedAt, paidMinor: schema.axisClaims.paidMinor })
    .from(schema.axisClaims)
    .where(
      and(
        eq(schema.axisClaims.tenantId, ctx.tenantId),
        isNotNull(schema.axisClaims.closedAt),
        gte(schema.axisClaims.closedAt, p.since),
        lt(schema.axisClaims.closedAt, p.until)
      )
    );
  if (!claims.length) return null;

  let reserveAt30 = 0;
  let finalPaid = 0;
  for (const claim of claims) {
    finalPaid += claim.paidMinor;
    const [reserve] = await ctx.db
      .select({ amountMinor: schema.axisClaimReserves.amountMinor })
      .from(schema.axisClaimReserves)
      .where(
        and(
          eq(schema.axisClaimReserves.tenantId, ctx.tenantId),
          eq(schema.axisClaimReserves.claimId, claim.id),
          eq(schema.axisClaimReserves.head, "indemnity"),
          lte(schema.axisClaimReserves.setAt, claim.reportedAt + 30 * DAY_MS)
        )
      )
      .orderBy(desc(schema.axisClaimReserves.setAt))
      .limit(1);
    reserveAt30 += reserve?.amountMinor ?? 0;
  }
  return finalPaid > 0 ? Math.round((reserveAt30 / finalPaid) * 10_000) : null;
};

const slaBreachRate: Compute = async (ctx, p) => {
  const [cases, claims] = await Promise.all([
    ctx.db
      .select({ slaDueAt: schema.axisCases.slaDueAt, closedAt: schema.axisCases.closedAt })
      .from(schema.axisCases)
      .where(
        and(
          eq(schema.axisCases.tenantId, ctx.tenantId),
          isNotNull(schema.axisCases.closedAt),
          gte(schema.axisCases.closedAt, p.since),
          lt(schema.axisCases.closedAt, p.until)
        )
      ),
    ctx.db
      .select({ slaDueAt: schema.axisClaims.slaDueAt, closedAt: schema.axisClaims.closedAt })
      .from(schema.axisClaims)
      .where(
        and(
          eq(schema.axisClaims.tenantId, ctx.tenantId),
          isNotNull(schema.axisClaims.closedAt),
          gte(schema.axisClaims.closedAt, p.since),
          lt(schema.axisClaims.closedAt, p.until)
        )
      )
  ]);
  const closed = [...cases, ...claims];
  if (!closed.length) return null;
  const breached = closed.filter((c) => c.slaDueAt !== null && c.closedAt! > c.slaDueAt).length;
  return Math.round((breached / closed.length) * 10_000);
};

/** Point-in-time gauge: "as of now", not scoped to the period window. */
const openClaimCount: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.axisClaims)
    .where(
      and(
        eq(schema.axisClaims.tenantId, ctx.tenantId),
        isNull(schema.axisClaims.closedAt),
        notInArray(schema.axisClaims.status, ["withdrawn", "rejected"])
      )
    );
  return row?.n ?? 0;
};

/** Point-in-time gauge: "as of now", not scoped to the period window. */
const outstandingReserve: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const [row] = await ctx.db
    .select({ v: sql<number>`coalesce(sum(${schema.axisClaims.reserveMinor}), 0)` })
    .from(schema.axisClaims)
    .where(eq(schema.axisClaims.tenantId, ctx.tenantId));
  return row?.v ?? 0;
};

/**
 * SCOUT -> NORTH: of the gaps raised this month, the share the business
 * decided to act on. Same mixed-cohort window `quote_to_bind_rate` uses —
 * promoted-in-period over raised-in-period, not a cohort followed forward.
 */
const whitespacePromotionRate: Compute = async (ctx, p) => {
  if (p.grain !== "month") return null;
  const [row] = await ctx.db
    .select({
      raised: sql<number>`count(*)`,
      promoted: sql<number>`sum(case when ${schema.scoutWhitespaces.promotedAt} is not null then 1 else 0 end)`
    })
    .from(schema.scoutWhitespaces)
    .where(
      and(eq(schema.scoutWhitespaces.tenantId, ctx.tenantId), gte(schema.scoutWhitespaces.createdAt, p.since), lt(schema.scoutWhitespaces.createdAt, p.until))
    );
  const raised = row?.raised ?? 0;
  return raised > 0 ? Math.round(((row?.promoted ?? 0) / raised) * 10_000) : null;
};

/**
 * SIGNAL -> NORTH: what the spend brought back, as bp of itself (30,000 = 3x).
 * Only a `bind` touch carries realised value; spend with no bind against it is
 * a real zero, spend of nothing is not a ratio at all.
 */
const campaignReturnOnSpend: Compute = async (ctx, p) => {
  const [spent, returned] = await Promise.all([
    ctx.db
      .select({ v: sql<number>`coalesce(sum(${schema.signalSpend.amountMinor}), 0)` })
      .from(schema.signalSpend)
      .where(and(eq(schema.signalSpend.tenantId, ctx.tenantId), gte(schema.signalSpend.ts, p.since), lt(schema.signalSpend.ts, p.until)))
      .then((r) => r[0]?.v ?? 0),
    ctx.db
      .select({ v: sql<number>`coalesce(sum(${schema.signalAttributionEvents.valueMinor}), 0)` })
      .from(schema.signalAttributionEvents)
      .where(
        and(
          eq(schema.signalAttributionEvents.tenantId, ctx.tenantId),
          eq(schema.signalAttributionEvents.touchType, "bind"),
          gte(schema.signalAttributionEvents.ts, p.since),
          lt(schema.signalAttributionEvents.ts, p.until)
        )
      )
      .then((r) => r[0]?.v ?? 0)
  ]);
  return spent > 0 ? Math.round((returned / spent) * 10_000) : null;
};

/**
 * ADR-0024: registered metric keys only. `claims_leakage` is deliberately
 * absent — its "assessed should have paid" side has no matching schema
 * field anywhere, so there's nothing to compute without guessing.
 */
const REGISTRY: Record<string, Compute> = {
  policies_issued: policiesIssued,
  quote_to_bind_rate: quoteToBindRate,
  panel_response_rate: panelResponseRate,
  quote_latency_p95: quoteLatencyP95,
  gwp,
  net_commission: netCommission,
  active_policies: activePolicies,
  cac_per_policy: cacPerPolicy,
  broker_channel_share: brokerChannelShare,
  ai_cost_per_case: aiCostPerCase,
  gross_written_premium: grossWrittenPremium,
  net_written_premium: netWrittenPremium,
  loss_ratio: lossRatio,
  expense_ratio: expenseRatio,
  combined_ratio: combinedRatio,
  renewal_retention: renewalRetention,
  quote_hit_rate: quoteHitRate,
  avg_handling_time_claims: avgHandlingTimeClaims,
  avg_handling_time_cases: avgHandlingTimeCases,
  reserve_adequacy: reserveAdequacy,
  sla_breach_rate: slaBreachRate,
  open_claim_count: openClaimCount,
  outstanding_reserve: outstandingReserve,
  whitespace_promotion_rate: whitespacePromotionRate,
  campaign_return_on_spend: campaignReturnOnSpend
};

/** Same move/threshold basis every unit family uses for a naive, seasonal-unaware anomaly flag (ADR-0024). */
function anomalyThresholdBp(unit: string): number {
  return unit === "percent" || unit === "ratio" ? 500 : 1_500;
}

/* ---------------------------------------------------------- driver analysis */

/** Same key shape seed.ts writes, so seeded and computed slices share one key space. */
const dimsHashOf = (dims: Record<string, string>): string =>
  Object.entries(dims)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

interface Slice {
  key: string;
  value: number;
}

/**
 * Sum the same policy rows the grand total sums, grouped by one dimension.
 * Rows with no value for that dimension are left out on purpose: a single
 * "unassigned" bucket explains nothing, and a driver list should only claim
 * the part of a move it can actually attribute.
 */
const policiesBy =
  (column: typeof schema.axisPolicies.channelId, value: ReturnType<typeof sql<number>>) =>
  async (ctx: Ctx, p: Period): Promise<Slice[]> => {
    const rows = await ctx.db
      .select({ key: column, value })
      .from(schema.axisPolicies)
      .where(
        and(
          eq(schema.axisPolicies.tenantId, ctx.tenantId),
          isNotNull(column),
          gte(schema.axisPolicies.createdAt, p.since),
          lt(schema.axisPolicies.createdAt, p.until)
        )
      )
      .groupBy(column);
    return rows.map((row) => ({ key: String(row.key), value: Number(row.value ?? 0) }));
  };

/**
 * Metrics whose movement decomposes additively. Without these the anomaly card
 * can say a number moved but never which channel moved it. Ratios are
 * deliberately absent: a ratio's parts don't sum to the whole, so decomposing
 * one needs a stated method, not a group-by.
 */
const SLICED: Record<string, { dimension: string; slice: (ctx: Ctx, p: Period) => Promise<Slice[]> }> = {
  policies_issued: { dimension: "channel", slice: policiesBy(schema.axisPolicies.channelId, sql<number>`count(*)`) },
  gwp: {
    dimension: "channel",
    slice: policiesBy(schema.axisPolicies.channelId, sql<number>`coalesce(sum(${schema.axisPolicies.premiumMinor}), 0)`)
  },
  net_commission: {
    dimension: "channel",
    slice: policiesBy(schema.axisPolicies.channelId, sql<number>`coalesce(sum(${schema.axisPolicies.commissionMinor}), 0)`)
  }
};

/** ponytail: a card shows a handful of bars; the long tail is noise. */
const MAX_DRIVERS = 5;

interface Driver {
  dimension: string;
  key: string;
  contributionBps: number;
}

/** Each dimension value's share of the grand-total move, in bp of the prior total — same basis as the anomaly's magnitude. */
function driversOf(dimension: string, prior: Map<string, number>, current: Slice[], prevTotal: number): Driver[] {
  const drivers: Driver[] = [];
  const seen = new Set<string>();
  const push = (key: string, delta: number): void => {
    const contributionBps = Math.round((delta / Math.abs(prevTotal)) * 10_000);
    if (contributionBps !== 0) drivers.push({ dimension, key, contributionBps });
  };
  for (const slice of current) {
    const key = slice.key;
    seen.add(key);
    push(key, slice.value - (prior.get(key) ?? 0));
  }
  // A value that vanished moved the total too.
  for (const [key, value] of prior) {
    if (!seen.has(key)) push(key, -value);
  }
  return drivers.sort((a, b) => Math.abs(b.contributionBps) - Math.abs(a.contributionBps)).slice(0, MAX_DRIVERS);
}

function breaches(operator: string, value: number, threshold: number): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    default:
      return false; // unknown operator: don't guess
  }
}

/**
 * Write today's snapshots for every registered metric, then flag anomalies
 * against the immediately preceding period of the same grain. Idempotent:
 * upserts by the `(tenant, metric, grain, period, dims_hash)` unique index,
 * so a missed or repeated nightly tick costs nothing.
 */
export async function runSnapshotter(ctx: Ctx): Promise<{ written: number; anomalies: number; alertsTriggered: number }> {
  const unsortedMetrics = await ctx.db
    .select()
    .from(schema.northMetrics)
    .where(eq(schema.northMetrics.tenantId, ctx.tenantId));
  // combined_ratio reads loss_ratio/expense_ratio's just-written rows (§F), so it must run last.
  const metrics = unsortedMetrics
    .slice()
    .sort((a, b) => (a.key === "combined_ratio" ? 1 : 0) - (b.key === "combined_ratio" ? 1 : 0));

  const rules = await ctx.db
    .select()
    .from(schema.northAlertRules)
    .where(and(eq(schema.northAlertRules.tenantId, ctx.tenantId), eq(schema.northAlertRules.enabled, true)));

  let written = 0;
  let anomalies = 0;
  let alertsTriggered = 0;

  for (const metric of metrics) {
    const compute = REGISTRY[metric.key];
    if (!compute) continue; // unregistered metric: skip, don't guess (ADR-0024)

    for (const p of periodsFor(ctx.now)) {
      if (p.grain !== metric.grain) continue;
      const value = await compute(ctx, p);
      if (value === null) continue;

      const rows = await ctx.db
        .select({ id: schema.northSnapshots.id, value: schema.northSnapshots.value, dimsHash: schema.northSnapshots.dimsHash })
        .from(schema.northSnapshots)
        .where(
          and(
            eq(schema.northSnapshots.tenantId, ctx.tenantId),
            eq(schema.northSnapshots.metricKey, metric.key),
            eq(schema.northSnapshots.grain, p.grain),
            eq(schema.northSnapshots.period, p.period)
          )
        );
      const existing = rows.find((row) => row.dimsHash === "");

      if (existing) {
        await ctx.db
          .update(schema.northSnapshots)
          .set({ value, ts: ctx.now })
          .where(eq(schema.northSnapshots.id, existing.id));
      } else {
        await ctx.db.insert(schema.northSnapshots).values({
          id: newId("snp", ctx.now),
          tenantId: ctx.tenantId,
          metricKey: metric.key,
          grain: p.grain,
          period: p.period,
          dimsHash: "",
          value,
          ts: ctx.now
        });
      }
      // `written` counts grand totals; the slices below are the same numbers cut up.
      written++;

      // Dimensional slices of the same number, so an anomaly can name what moved.
      const sliced = SLICED[metric.key];
      const prior = new Map<string, number>();
      let current: Slice[] = [];
      if (sliced) {
        const prefix = `${sliced.dimension}=`;
        const priorRows = new Map(rows.filter((row) => row.dimsHash.startsWith(prefix)).map((row) => [row.dimsHash, row]));
        for (const [hash, row] of priorRows) prior.set(hash.slice(prefix.length), row.value);
        current = await sliced.slice(ctx, p);
        for (const slice of current) {
          const dims = { [sliced.dimension]: slice.key };
          const hash = dimsHashOf(dims);
          const before = priorRows.get(hash);
          if (before) {
            await ctx.db
              .update(schema.northSnapshots)
              .set({ value: slice.value, ts: ctx.now })
              .where(eq(schema.northSnapshots.id, before.id));
          } else {
            await ctx.db.insert(schema.northSnapshots).values({
              id: newId("snp", ctx.now),
              tenantId: ctx.tenantId,
              metricKey: metric.key,
              grain: p.grain,
              period: p.period,
              dimsJson: JSON.stringify(dims),
              dimsHash: hash,
              value: slice.value,
              ts: ctx.now
            });
          }
        }
      }

      for (const rule of rules) {
        if (rule.metricKey !== metric.key || rule.windowGrain !== p.grain) continue;
        if (!breaches(rule.operator, value, rule.thresholdValue)) continue;
        await emit(ctx, {
          module: "north",
          type: "north.alert.triggered",
          subject: rule.id,
          data: { ruleId: rule.id, metricKey: metric.key, value, thresholdValue: rule.thresholdValue, operator: rule.operator, grain: p.grain, period: p.period }
        });
        alertsTriggered++;
      }

      const prevValue = existing?.value;
      if (prevValue !== undefined && prevValue !== 0) {
        const magnitudeBp = Math.round(((value - prevValue) / Math.abs(prevValue)) * 10_000);
        if (Math.abs(magnitudeBp) >= anomalyThresholdBp(metric.unit)) {
          const [openAnomaly] = await ctx.db
            .select({ id: schema.northAnomalies.id })
            .from(schema.northAnomalies)
            .where(
              and(
                eq(schema.northAnomalies.tenantId, ctx.tenantId),
                eq(schema.northAnomalies.metricKey, metric.key),
                eq(schema.northAnomalies.window, p.period),
                eq(schema.northAnomalies.state, "new")
              )
            );
          if (!openAnomaly) {
            const drivers = sliced ? driversOf(sliced.dimension, prior, current, prevValue) : [];
            await ctx.db.insert(schema.northAnomalies).values({
              id: newId("anm", ctx.now),
              tenantId: ctx.tenantId,
              metricKey: metric.key,
              window: p.period,
              magnitude: magnitudeBp,
              expected: prevValue,
              actual: value,
              state: "new",
              // The basis is the previous run of the same period, not the previous period — say so.
              driverAnalysisJson: drivers.length
                ? JSON.stringify({ method: "dimensional_delta", baseline: "previous_snapshot", drivers })
                : null,
              detectedAt: ctx.now
            });
            anomalies++;
          }
        }
      }
    }
  }

  return { written, anomalies, alertsTriggered };
}
