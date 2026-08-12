import { and, eq, gte, inArray } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { clusterSignals, computeWhitespaceCandidates, type CoverageInput } from "@lyra/core";
import type { RawSignal } from "@lyra/core";
import type { Gateway } from "@lyra/model-gateway";

// docs/modules/scout.md §8 clause 1: "from tenant's 12-month quote export
// alone, produce a first Radar with >= 5 evidenced whitespace candidates."
// This sweep is the cold-start Clusterer run against real AXIS data instead
// of the 7 hand-written seed/scout.ts rows — same idiom as orbit.ts's
// /renewals/sweep (a computed batch, not one-row CRUD, so no create
// permission is exposed on the resource — see resources.ts's scoutWhitespaces
// entry).

/** Half the 12-month export docs/8 clause 1 names — splits it into a recent
 *  and prior window for clusterSignals' growth comparison. */
const COLD_START_WINDOW_MS = 182 * 86_400_000;
const LOOKBACK_MS = 2 * COLD_START_WINDOW_MS;

/** Active policy count per core_products.line — the real coverage source
 *  whitespace.ts's header comment names. Shared with the negotiation-pack
 *  route so `coverage` there is a live number, not a stale persisted one. */
export async function coveragePerLine(ctx: Ctx): Promise<Map<string, number>> {
  const policyRows = await ctx.db
    .select({ line: schema.products.line })
    .from(schema.axisPolicies)
    .innerJoin(schema.products, eq(schema.products.id, schema.axisPolicies.productId))
    .where(and(eq(schema.axisPolicies.tenantId, ctx.tenantId), eq(schema.axisPolicies.status, "active")));
  const byLine = new Map<string, number>();
  for (const p of policyRows) byLine.set(p.line, (byLine.get(p.line) ?? 0) + 1);
  return byLine;
}

/** docs/modules/scout.md §3 "Whitespace Drafter | cluster momentum > θ |
 *  reasoning | no (drafts)" — the dossier's headline sentence, drafted from
 *  the same momentum/coverage numbers a human analyst would read off the
 *  Radar, module "scout" (CLAUDE.md rule 3). Drafts only, never blocks the
 *  sweep: `sweepWhitespace` still persists on a gateway failure would abort
 *  the whole batch, so the caller catches per-candidate and falls back to the
 *  plain figures (ponytail: no retry/backoff — a bad draft this run gets a
 *  fresh candidate row next sweep, same idempotency guard as the rest). */
function buildDescriptionPrompt(c: { category: string; momentum: number; coverage: number }): {
  system: string;
  user: string;
} {
  return {
    system:
      "You write one short, factual sentence for an insurance whitespace dossier. State the demand " +
      "signal and current coverage plainly. Never invent a number not given to you. No preamble, no quotes.",
    user: `Category: ${c.category}\nDemand momentum score: ${c.momentum}\nActive policies on the book: ${c.coverage}`
  };
}

/** Insert a `candidate` row for every category flagged whitespace by real
 *  quote demand vs. this tenant's own policy coverage. Not visible (below the
 *  k-anonymity floor) candidates are never persisted — scout_whitespaces has
 *  no suppression column, so the only safe place to hide one is here.
 *  Idempotent per category: re-running skips a category that already has a
 *  live (candidate|validating|validated) row. */
export async function sweepWhitespace(ctx: Ctx, gateway: Gateway): Promise<number> {
  // docs/27 F13: demand is every answer the panel gave, plus the ones the desk
  // keyed by hand — one table. The grouping key is the product's line, read
  // through the request rather than off the case, so a shop that never opened
  // a case still counts as demand.
  const quotes = await ctx.db
    .select({
      id: schema.distQuoteResponses.id,
      category: schema.products.line,
      customerId: schema.distQuoteRequests.customerId,
      requestId: schema.distQuoteResponses.requestId,
      providerId: schema.distQuoteResponses.providerId,
      state: schema.distQuoteResponses.state,
      createdAt: schema.distQuoteResponses.createdAt
    })
    .from(schema.distQuoteResponses)
    .innerJoin(schema.distQuoteRequests, eq(schema.distQuoteRequests.id, schema.distQuoteResponses.requestId))
    .innerJoin(schema.products, eq(schema.products.id, schema.distQuoteRequests.productId))
    .where(
      and(
        eq(schema.distQuoteResponses.tenantId, ctx.tenantId),
        gte(schema.distQuoteResponses.createdAt, ctx.now - LOOKBACK_MS)
      )
    );

  const signals: RawSignal[] = quotes.map((q) => ({
    id: q.id,
    category: q.category,
    sourceRef: q.customerId,
    weight: 1,
    observedAt: q.createdAt
  }));
  if (!signals.length) return 0;

  // Re-scored every sweep, before any early return: the cluster's momentum is
  // the Radar's vertical axis, so a tenant whose candidates are all still live
  // would otherwise read last quarter's demand forever.
  const clusterIdByCategory = await persistClusters(ctx, signals);

  const coverageByLine = await coveragePerLine(ctx);
  const coverage: CoverageInput[] = [...coverageByLine].map(([category, policyCount]) => ({ category, policyCount }));

  const candidates = computeWhitespaceCandidates(signals, coverage, ctx.now, COLD_START_WINDOW_MS).filter(
    (c) => c.visible
  );
  if (!candidates.length) return 0;

  const live = await ctx.db
    .select({ category: schema.scoutWhitespaces.category })
    .from(schema.scoutWhitespaces)
    .where(
      and(
        eq(schema.scoutWhitespaces.tenantId, ctx.tenantId),
        inArray(schema.scoutWhitespaces.status, ["candidate", "validating", "validated"])
      )
    );
  const liveCategories = new Set(live.map((r) => r.category));

  const fresh = candidates.filter((c) => !liveCategories.has(c.category));
  if (!fresh.length) return 0;

  const evidenceByCategory = new Map<string, string[]>();
  for (const s of signals) {
    const bucket = evidenceByCategory.get(s.category);
    if (bucket) bucket.push(s.id);
    else evidenceByCategory.set(s.category, [s.id]);
  }

  const competition = competitionByCategory(quotes);

  const rows = await Promise.all(
    fresh.map(async (c) => {
      const fallback = `${c.category}: demand momentum ${c.momentum} vs. ${c.coverage} policies on the book`;
      const description = await draftDescription(ctx, gateway, c).catch(() => fallback);
      return {
        id: newId("wsp", ctx.now),
        tenantId: ctx.tenantId,
        description,
        category: c.category,
        clusterId: clusterIdByCategory.get(c.category) ?? null,
        evidenceRefsJson: JSON.stringify((evidenceByCategory.get(c.category) ?? []).slice(0, 50)),
        demandEstimate: c.momentum,
        competitionScore: competition.get(c.category) ?? null,
        status: "candidate",
        owner: null,
        promotedAt: null,
        createdAt: ctx.now,
        updatedAt: ctx.now
      };
    })
  );

  await ctx.db.insert(schema.scoutWhitespaces).values(rows as never);
  return rows.length;
}

/**
 * The Clusterer's persisted output: one `scout_clusters` row per category the
 * window saw, re-scored in place on every sweep. Both SCOUT surfaces read it —
 * the Clusters tab directly, and the Radar through `scout_whitespaces.cluster_id`,
 * which is the vertical axis of the quadrant (docs/27 F11: a whitespace row
 * with no cluster cannot be plotted at a momentum nobody measured).
 */
async function persistClusters(ctx: Ctx, signals: readonly RawSignal[]): Promise<Map<string, string>> {
  const clusters = clusterSignals(signals, ctx.now, COLD_START_WINDOW_MS);
  if (!clusters.length) return new Map();

  const seen = await ctx.db
    .select({ id: schema.scoutClusters.id, theme: schema.scoutClusters.theme })
    .from(schema.scoutClusters)
    .where(eq(schema.scoutClusters.tenantId, ctx.tenantId));
  const existing = new Map(seen.map((r) => [r.theme, r.id]));

  const seenAt = new Map<string, { first: number; last: number }>();
  for (const s of signals) {
    const span = seenAt.get(s.category);
    if (!span) seenAt.set(s.category, { first: s.observedAt, last: s.observedAt });
    else {
      span.first = Math.min(span.first, s.observedAt);
      span.last = Math.max(span.last, s.observedAt);
    }
  }

  const out = new Map<string, string>();
  for (const c of clusters) {
    const span = seenAt.get(c.category) ?? { first: ctx.now, last: ctx.now };
    const known = existing.get(c.category);
    if (known) {
      out.set(c.category, known);
      await ctx.db
        .update(schema.scoutClusters)
        .set({ momentumScore: c.momentum, size: c.signalIds.length, lastSeen: span.last, updatedAt: ctx.now })
        .where(and(eq(schema.scoutClusters.tenantId, ctx.tenantId), eq(schema.scoutClusters.id, known)));
      continue;
    }
    const id = newId("clu", ctx.now);
    out.set(c.category, id);
    await ctx.db.insert(schema.scoutClusters).values({
      id,
      tenantId: ctx.tenantId,
      theme: c.category,
      summary: null,
      momentumScore: c.momentum,
      size: c.signalIds.length,
      firstSeen: span.first,
      lastSeen: span.last,
      trailJson: null,
      updatedAt: ctx.now
    } as never);
  }
  return out;
}

/**
 * How contested a line is, 0-100, as the share of the panel that actually
 * competes for one of its requests: average distinct insurers quoting a request
 * on this line, over the whole panel that quoted anything in the window. A line
 * every insurer bids on scores 100; a line one insurer of eight bothers with
 * scores 12.
 *
 * ponytail: panel breadth is a proxy for market competition, not a measurement
 * of it — the tenant's own panel is the only competitive evidence LYRA holds
 * (docs §2.5). A real market-share feed replaces this function and nothing else.
 */
function competitionByCategory(
  quotes: readonly { category: string; requestId: string; providerId: string; state: string }[]
): Map<string, number> {
  const quoted = quotes.filter((q) => q.state === "quoted");
  const panel = new Set(quoted.map((q) => q.providerId)).size;
  if (panel === 0) return new Map();

  // category -> request -> the insurers that bid on it. Nested rather than one
  // joined string key: a product line may contain whatever separator we picked.
  const byCategory = new Map<string, Map<string, Set<string>>>();
  for (const q of quoted) {
    const requests = byCategory.get(q.category) ?? new Map<string, Set<string>>();
    const bidders = requests.get(q.requestId) ?? new Set<string>();
    bidders.add(q.providerId);
    requests.set(q.requestId, bidders);
    byCategory.set(q.category, requests);
  }

  const out = new Map<string, number>();
  for (const [category, requests] of byCategory) {
    let bids = 0;
    for (const bidders of requests.values()) bids += bidders.size;
    const avgBidders = bids / requests.size;
    out.set(category, Math.max(0, Math.min(100, Math.round((avgBidders / panel) * 100))));
  }
  return out;
}

async function draftDescription(
  ctx: Ctx,
  gateway: Gateway,
  c: { category: string; momentum: number; coverage: number }
): Promise<string> {
  const { system, user } = buildDescriptionPrompt(c);
  const res = await gateway.complete(ctx, {
    module: "scout",
    purpose: "whitespace.describe",
    tier: "reasoning",
    subjectRef: c.category,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  const text = res.text.trim();
  if (!text) throw new Error("empty draft");
  return text;
}
