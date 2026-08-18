import { parseJsonObject } from "./parse.js";

// docs/specs/gap-axis-design.md §G.3. Reserve recommendation: given the peril,
// cause, severity signal (complexity), policy limits/excess, and the tenant's
// own comparable closed claims, suggest what the indemnity reserve should be.
//
// Ambient, not consequential (CLAUDE.md §4): the recommendation is only a
// draft on the claim. Writing it still goes through appendReserve
// (apps/api/src/engines/axis-claim-lifecycle.ts), which gates above
// RESERVE_THRESHOLD_MINOR like any other reserve movement — a low-confidence
// or failed call must never block claim handling (docs §D.1).

export interface ReserveComparable {
  id: string;
  perilCode: string | null;
  causeCode: string | null;
  reserveMinor: number;
  paidMinor: number;
  settledMinor: number | null;
}

export interface ReserveContext {
  perilCode: string | null;
  causeCode: string | null;
  complexity: string | null;
  excessMinor: number | null;
  limits: Record<string, number> | null;
  comparables: ReserveComparable[];
}

export interface ReserveRecommendation {
  recommendedMinor: number | null;
  /** [low, high], null when the model's reply did not give a usable band. */
  band: [number, number] | null;
  /** 0-100. Schema-conformance heuristic, same basis as triage.ts's `Triage.confidence`. */
  confidence: number;
  /** Comparable claim ids the model says it weighed — cross-check against `ReserveContext.comparables` before trusting. */
  comparables: string[];
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function reserveSchema(): Record<string, unknown> {
  return {
    name: "axis_claim_reserve_recommend",
    schema: {
      type: "object",
      properties: {
        recommendedMinor: { type: "integer" },
        bandLowMinor: { type: "integer" },
        bandHighMinor: { type: "integer" },
        comparables: { type: "array", items: { type: "string" } }
      },
      required: ["recommendedMinor", "bandLowMinor", "bandHighMinor", "comparables"]
    }
  };
}

/**
 * The reserve-recommendation prompt, in one place, shared verbatim between the
 * eval harness and the production engine (apps/api/src/engines/axis-reserve-advisor.ts),
 * per docs/27 F10's "the live eval must send the prompt production sends."
 *
 * CLAUDE.md §14: no domain-pack noun appears here. It reads "claim" and "the
 * amount to set aside", so the same prompt reserves a warranty repair or a
 * service-credit case without an edit. (`perilCode`, `excessMinor` and the rest
 * are wire field names fixed by the schema, not vocabulary shown to a user.)
 */
export function reserveMessages(ctx: ReserveContext): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You are estimating the amount to set aside for one open claim, from its perilCode, causeCode, " +
        "complexity, excessMinor, the limits given, and a list of the tenant's own comparable closed claims " +
        "(same perilCode, closed within the last 24 months). Reply with JSON only, matching the schema: " +
        "recommendedMinor (the point estimate, in minor currency units), bandLowMinor and bandHighMinor " +
        "(a plausible low/high range around it, bandLowMinor <= recommendedMinor <= bandHighMinor), and " +
        "comparables (the ids, from the list given, of the comparable claims you actually weighed). " +
        "Never recommend above the limit that matches the claim, and never below excessMinor. " +
        "If there are no useful comparables, say so by returning an empty comparables array rather than inventing one."
    },
    { role: "user", content: JSON.stringify(ctx) }
  ];
}

const FIELDS = ["recommendedMinor", "bandLowMinor", "bandHighMinor", "comparables"] as const;

/** Parses one model reply. Never throws — a bad reply recommends nothing. */
export function parseReserve(reply: string): ReserveRecommendation {
  const parsed = parseJsonObject(reply) ?? {};

  const rawRecommended = parsed.recommendedMinor;
  const rawLow = parsed.bandLowMinor;
  const rawHigh = parsed.bandHighMinor;
  const rawComparables = parsed.comparables;

  const recommendedMinor =
    typeof rawRecommended === "number" && Number.isFinite(rawRecommended) && rawRecommended >= 0
      ? Math.round(rawRecommended)
      : null;

  const low = typeof rawLow === "number" && Number.isFinite(rawLow) && rawLow >= 0 ? Math.round(rawLow) : null;
  const high = typeof rawHigh === "number" && Number.isFinite(rawHigh) && rawHigh >= 0 ? Math.round(rawHigh) : null;
  const band: [number, number] | null = low !== null && high !== null && low <= high ? [low, high] : null;

  const comparables = Array.isArray(rawComparables)
    ? rawComparables.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  const present = [recommendedMinor !== null, low !== null, high !== null, Array.isArray(rawComparables)].filter(Boolean).length;
  return {
    recommendedMinor,
    band,
    comparables,
    confidence: Math.round((present / FIELDS.length) * 100)
  };
}
