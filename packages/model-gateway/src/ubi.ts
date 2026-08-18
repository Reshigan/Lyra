import { parseJsonObject } from "./parse.js";

// docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md (Group E,
// usage-based pricing). Given aggregated usage/sensor series for one subject over
// an exposure window, and the book baseline for each series, estimate a signed
// price adjustment and name the series each part of it is read from.
//
// The adjustment is only ever a *proposal*. It is consequential (CLAUDE.md §4 —
// pricing) and lands as a UBI-REPRICE transaction, which reuses ENDORSE's
// approval gate and posting recipe; nothing here writes a price. The model may
// not skip that gate, and this module deliberately gives it no way to.
//
// Parts per million, not minor units, and no currency field: the model reasons
// about "12% worse than the book", the engine converts against the contract it
// already holds. Handing the model money would let it invent an amount that no
// stored contract has to agree with.

/** ±25%. A model that returns 900% must not be able to bill it. */
export const MAX_REPRICE_PPM = 250_000;

export interface UbiSeriesTotal {
  /** Series key — exactly the `source` column of axis_telemetry_points, e.g. "telematics:obd:km". */
  source: string;
  /** Sum of the series' point values across the window. */
  total: number;
  /** How many points that total came from — a total off two points is not evidence. */
  pointCount: number;
  /** The book/expected total for this series over the same window, or null when the book has none. */
  baseline: number | null;
}

/**
 * Everything the model is told. Deliberately only the series, their book
 * baselines and the window: no identity, location, age, gender or any other
 * protected characteristic or proxy for one, because a price moved by a proxy
 * is the thing a regulator asks about and the cheapest way not to do it is not
 * to send it. `parseUbi` reinforces this by ignoring every field it does not
 * model, so a proxy the model invents in its reply cannot reach the engine either.
 */
export interface UbiContext {
  series: UbiSeriesTotal[];
  /** Exposure window the totals cover, epoch ms. */
  windowStart: number;
  windowEnd: number;
}

export interface UbiFactor {
  code: string;
  weight: number;
  /** The series key this part of the adjustment is read from. */
  evidenceRef: string;
}

export interface UbiRepriceResult {
  /** Signed, clamped to ±MAX_REPRICE_PPM. Zero whenever no factor survives evidence-checking — see parseUbi. */
  premiumDeltaPpm: number;
  /** evidenceRef-bearing only. "A factor with no evidenceRef is dropped before pricing — no unexplainable price change." */
  factors: UbiFactor[];
  /** Factors the model named but gave no usable evidenceRef for — dropped, never priced. */
  droppedFactorCount: number;
  /** 0..1 as the model reported it; 0 when absent or unparseable. */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function ubiSchema(): Record<string, unknown> {
  return {
    name: "axis_usage_price_adjustment",
    schema: {
      type: "object",
      properties: {
        premiumDeltaPpm: { type: "integer" },
        factors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              weight: { type: "number" },
              evidenceRef: { type: "string" }
            },
            required: ["code", "weight", "evidenceRef"]
          }
        },
        confidence: { type: "number" }
      },
      required: ["premiumDeltaPpm", "factors"]
    }
  };
}

/**
 * The reprice prompt, in one place, shared verbatim between the eval harness
 * (evals/ubi-reprice) and the production engine, per docs/27 F10's "the live
 * eval must send the prompt production sends."
 *
 * CLAUDE.md §14: no domain-pack noun appears here. It reads "subject",
 * "measurement series" and "price", so the same prompt prices a fleet lease or
 * a machine-hours contract without an edit. (`premiumDeltaPpm` is a wire field
 * name fixed by the schema, not vocabulary shown to a user.)
 */
export function ubiMessages(ctx: UbiContext): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You are estimating a usage-based price adjustment for one subject from aggregated measurement series. " +
        "Each series carries its key, its total over the exposure window, the number of points behind that " +
        "total, and the book baseline expected for that key. Reply with JSON only, matching the schema: " +
        "premiumDeltaPpm (a signed adjustment in parts per million of the current price — positive when the " +
        "measured usage is worse than the baseline, negative when it is better, 0 when it matches), factors " +
        "(each with code, a short slug naming the signal; weight, its share of the adjustment; and " +
        "evidenceRef, the series key the signal is read from), and confidence (0 to 1). Every factor must " +
        `name the series key it is read from; never invent one you cannot point to a series for. Never ` +
        "return a non-zero premiumDeltaPpm with an empty factors array — an unexplained price change is not " +
        `a price change. Keep the adjustment within ±${MAX_REPRICE_PPM} ppm; anything beyond that is ` +
        "rejected. Reason only from the series given: who the subject is, how old they are and where they " +
        "are is neither in scope nor in the input."
    },
    { role: "user", content: JSON.stringify(ctx) }
  ];
}

/**
 * Parses one model reply. Never throws — a bad reply moves no price. The object
 * guard lives in `parseJsonObject` (parse.ts): `JSON.parse` happily returns
 * `null`, a number or a string for a reply that is valid JSON but not an object,
 * and property access on `null` would throw straight through the try/catch.
 */
export function parseUbi(reply: string): UbiRepriceResult {
  const parsed = parseJsonObject(reply) ?? {};

  const candidates = Array.isArray(parsed.factors)
    ? parsed.factors.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];

  const factors: UbiFactor[] = [];
  for (const raw of candidates) {
    const { code, weight, evidenceRef } = raw;
    if (
      typeof code === "string" &&
      code.trim().length > 0 &&
      typeof weight === "number" &&
      Number.isFinite(weight) &&
      typeof evidenceRef === "string" &&
      evidenceRef.trim().length > 0
    ) {
      factors.push({ code, weight, evidenceRef });
    }
  }

  const rawDelta = parsed.premiumDeltaPpm;
  const clamped =
    typeof rawDelta === "number" && Number.isFinite(rawDelta)
      ? Math.max(-MAX_REPRICE_PPM, Math.min(MAX_REPRICE_PPM, Math.round(rawDelta)))
      : 0;

  const rawConfidence = parsed.confidence;

  return {
    // No unexplainable price change: an adjustment with no surviving, evidenced
    // factor is not an adjustment, however confident the model sounded.
    premiumDeltaPpm: factors.length > 0 ? clamped : 0,
    factors,
    droppedFactorCount: candidates.length - factors.length,
    confidence:
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(1, rawConfidence))
        : 0
  };
}
