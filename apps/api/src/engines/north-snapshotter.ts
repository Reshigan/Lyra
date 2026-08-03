import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

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

/**
 * ADR-0024: registered metric keys only. `loss_ratio` and
 * `renewal_retention_rate` are deliberately absent — their formula basis is
 * an unresolved judgment call, flagged in the ADR, not guessed here.
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
  ai_cost_per_case: aiCostPerCase
};

/** Same move/threshold basis every unit family uses for a naive, seasonal-unaware anomaly flag (ADR-0024). */
function anomalyThresholdBp(unit: string): number {
  return unit === "percent" || unit === "ratio" ? 500 : 1_500;
}

/**
 * Write today's snapshots for every registered metric, then flag anomalies
 * against the immediately preceding period of the same grain. Idempotent:
 * upserts by the `(tenant, metric, grain, period, dims_hash)` unique index,
 * so a missed or repeated nightly tick costs nothing.
 */
export async function runSnapshotter(ctx: Ctx): Promise<{ written: number; anomalies: number }> {
  const metrics = await ctx.db
    .select()
    .from(schema.northMetrics)
    .where(eq(schema.northMetrics.tenantId, ctx.tenantId));

  let written = 0;
  let anomalies = 0;

  for (const metric of metrics) {
    const compute = REGISTRY[metric.key];
    if (!compute) continue; // unregistered metric: skip, don't guess (ADR-0024)

    for (const p of periodsFor(ctx.now)) {
      if (p.grain !== metric.grain) continue;
      const value = await compute(ctx, p);
      if (value === null) continue;

      const [existing] = await ctx.db
        .select({ id: schema.northSnapshots.id, value: schema.northSnapshots.value })
        .from(schema.northSnapshots)
        .where(
          and(
            eq(schema.northSnapshots.tenantId, ctx.tenantId),
            eq(schema.northSnapshots.metricKey, metric.key),
            eq(schema.northSnapshots.grain, p.grain),
            eq(schema.northSnapshots.period, p.period),
            eq(schema.northSnapshots.dimsHash, "")
          )
        );

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
      written++;

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
            await ctx.db.insert(schema.northAnomalies).values({
              id: newId("anm", ctx.now),
              tenantId: ctx.tenantId,
              metricKey: metric.key,
              window: p.period,
              magnitude: magnitudeBp,
              expected: prevValue,
              actual: value,
              state: "new",
              detectedAt: ctx.now
            });
            anomalies++;
          }
        }
      }
    }
  }

  return { written, anomalies };
}
