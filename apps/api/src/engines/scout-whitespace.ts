import { and, eq, gte, inArray } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { computeWhitespaceCandidates, type CoverageInput } from "@lyra/core";
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
  const quotes = await ctx.db
    .select({
      id: schema.axisQuotes.id,
      caseId: schema.axisQuotes.caseId,
      createdAt: schema.axisQuotes.createdAt
    })
    .from(schema.axisQuotes)
    .where(and(eq(schema.axisQuotes.tenantId, ctx.tenantId), gte(schema.axisQuotes.createdAt, ctx.now - LOOKBACK_MS)));
  if (!quotes.length) return 0;

  const caseIds = [...new Set(quotes.map((q) => q.caseId))];
  const cases = await ctx.db
    .select({ id: schema.axisCases.id, customerId: schema.axisCases.customerId, productLine: schema.axisCases.productLine })
    .from(schema.axisCases)
    .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), inArray(schema.axisCases.id, caseIds)));
  const caseById = new Map(cases.map((c) => [c.id, c]));

  const signals: RawSignal[] = [];
  for (const q of quotes) {
    const kase = caseById.get(q.caseId);
    if (!kase?.productLine) continue; // no grouping key, no signal
    signals.push({
      id: q.id,
      category: kase.productLine,
      sourceRef: kase.customerId,
      weight: 1,
      observedAt: q.createdAt
    });
  }
  if (!signals.length) return 0;

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

  const rows = await Promise.all(
    fresh.map(async (c) => {
      const fallback = `${c.category}: demand momentum ${c.momentum} vs. ${c.coverage} policies on the book`;
      const description = await draftDescription(ctx, gateway, c).catch(() => fallback);
      return {
        id: newId("wsp", ctx.now),
        tenantId: ctx.tenantId,
        description,
        category: c.category,
        clusterId: null,
        evidenceRefsJson: JSON.stringify((evidenceByCategory.get(c.category) ?? []).slice(0, 50)),
        demandEstimate: c.momentum,
        // ponytail: no competitor/market signal feeds this sweep yet (that is a
        // panel-bench concern, docs §2.5) — left null rather than invented.
        competitionScore: null,
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
