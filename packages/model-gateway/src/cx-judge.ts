import { parseJsonObject } from "./parse.js";

// docs/13 §3.3: "CX quality rubric >= 4.2/5 (ar+en separately - parity gap
// <= 0.2)", scored per §3.4 by "LLM-judge with a frozen judge version and n=5
// sampling; judge changes are themselves ADR'd". This file is that judge: the
// rubric, the prompt, the parse, and the aggregate. The eval task
// (evals/cx-quality) scores canned judge replies for the same reason evals/axis
// scores canned model replies — a gate that calls a live model is not a gate
// (docs/13 §4). docs/12 §4's weekly re-score is the live half and is ops, not CI.

/**
 * Bump this whenever the rubric or the prompt changes, and record the change in
 * an ADR (docs/13 §3.4). Scores from two versions are not comparable, so the
 * version travels inside the prompt: a judge run kept as evidence names the
 * rubric it was scored against.
 */
export const CX_JUDGE_VERSION = "cx-rubric-v3";

/**
 * The dimension that caps the composite (ADR-0074). Named rather than indexed
 * so `CX_RUBRIC` can be reordered without silently moving the veto.
 */
const VETO_DIMENSION = "accuracy";

/** docs/13 §3.4: five runs per sample, aggregated by median. */
export const CX_JUDGE_SAMPLES = 5;

const MIN_SCORE = 1;
const MAX_SCORE = 5;

export interface CxRubricDimension {
  name: string;
  /** What a 5 looks like — the judge scores against this sentence, not against taste. */
  asks: string;
}

/**
 * Four dimensions, equally weighted. Deliberately short: a rubric a judge has to
 * page through is a rubric it applies unevenly, and the dimensions that matter
 * for a customer reply are whether it is true, understandable, decent, and
 * useful.
 */
export const CX_RUBRIC: readonly CxRubricDimension[] = [
  {
    name: "accuracy",
    asks: "Every fact and number in the reply is supported by the conversation above. Nothing is invented, softened or rounded."
  },
  {
    name: "clarity",
    asks: "A customer with no insurance background understands it on one read. No jargon that is not explained, no wall of text."
  },
  {
    name: "tone",
    asks: "Respectful and human in the customer's own language, neither cold nor overfamiliar, and appropriate to the news being delivered."
  },
  {
    name: "actionability",
    asks: "The customer knows what happens next and what, if anything, they must do."
  }
];

export interface CxSample {
  /** BCP-47 base tag. Scored separately per docs/13 §3.3 — never averaged together. */
  locale: string;
  /** The conversation the reply answers, oldest first. */
  context: string[];
  /** The assistant reply under evaluation. */
  reply: string;
}

export function cxJudgePrompt(sample: CxSample): string {
  const dimensions = CX_RUBRIC.map((d) => `- ${d.name}: ${d.asks}`).join("\n");
  return [
    `You are scoring one customer-facing reply against rubric ${CX_JUDGE_VERSION}.`,
    "",
    `The conversation is in locale "${sample.locale}". Score the reply as written in that`,
    "language, on its own terms — do not translate it first, and do not reward or",
    "penalise a reply for the language it is in.",
    "",
    "Score each dimension from 1 (fails entirely) to 5 (could not be better):",
    dimensions,
    "",
    // ADR-0074 §4: v1 left this to inference and the judge inferred generously,
    // scoring an invented payout figure 1 on accuracy but the reply 4 overall.
    //
    // ADR-0077: v2 wrote that as an enumeration — "a number, date or decision" —
    // and a scope qualifier ("on each claim") is none of the three, so a reply
    // that attached an unsupported condition to a figure the conversation *did*
    // give fell outside the letter of the list. English read past it and scored
    // the reply down anyway; Arabic followed the list exactly and scored it 4.
    // A rule, not a longer list: any detail is the class, and the nouns survive
    // only as examples of it.
    "Score accuracy against the conversation above and nothing else. Any detail",
    "the conversation does not support is a 1 — a number, a date, a decision, and",
    "equally a scope, condition, exclusion, deadline or term attached to one that",
    "it does support. However well the reply is written — accuracy caps the",
    "overall score.",
    "",
    "Conversation:",
    ...sample.context,
    "",
    "Reply under evaluation:",
    sample.reply,
    "",
    `Answer with JSON only: {${CX_RUBRIC.map((d) => `"${d.name}": <1-5>`).join(", ")}, "why": "<one sentence>"}`
  ].join("\n");
}

export interface CxDimensionScores {
  /** Every dimension in `CX_RUBRIC`, by name. */
  dimensions: Record<string, number>;
  /** The composite the gate and the QA column use. */
  score: number;
  /** The judge's one-sentence rationale, when it gave one. */
  why?: string;
}

/**
 * One judge run to its full breakdown, or null if the run is unusable. Null
 * rather than a low score: a judge that returned prose, or dropped a dimension,
 * has told us nothing about the reply — scoring that as a 1 would let a flaky
 * judge fail a good sample.
 *
 * The composite is `min(mean, accuracy)` (ADR-0074). An equal-weight mean rated
 * a reply that invented a settlement figure 4.0/5, because it was clear, warm
 * and actionable about something untrue. Accuracy caps the score instead: a
 * reply is worth no more than it is true, however well it is written. The cap
 * does not bind on an accurate reply, where the mean still governs.
 */
export function parseCxDimensions(reply: string): CxDimensionScores | null {
  const parsed = parseJsonObject(reply);
  if (!parsed) return null;

  const dimensions: Record<string, number> = {};
  let total = 0;
  for (const dimension of CX_RUBRIC) {
    const value = parsed[dimension.name];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    // Out of range means the judge ignored the rubric it was handed. Clamping
    // would hide that; the run is discarded and the median carries the sample.
    if (value < MIN_SCORE || value > MAX_SCORE) return null;
    dimensions[dimension.name] = value;
    total += value;
  }

  const mean = total / CX_RUBRIC.length;
  const veto = dimensions[VETO_DIMENSION];
  const why = parsed["why"];
  return {
    dimensions,
    score: veto === undefined ? mean : Math.min(mean, veto),
    ...(typeof why === "string" ? { why } : {})
  };
}

/** The composite alone. See `parseCxDimensions` for how it is derived. */
export function parseCxScore(reply: string): number | null {
  return parseCxDimensions(reply)?.score ?? null;
}

/** Median of the parseable runs, or null when none parsed. */
export function aggregateCxScore(replies: readonly string[]): number | null {
  const scores = replies
    .map(parseCxScore)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  if (scores.length === 0) return null;
  const mid = scores.length >> 1;
  return scores.length % 2 === 1
    ? (scores[mid] as number)
    : ((scores[mid - 1] as number) + (scores[mid] as number)) / 2;
}

/**
 * The ar/en parity gap (docs/12 §4: "Arabic/English parity is a tracked metric,
 * not an aspiration"). Absolute, because the requirement is that the two
 * languages are served equally well — not that Arabic keeps up with English.
 */
export function localeGap(a: number, b: number): number {
  return Math.abs(a - b);
}

export interface CxScoredSample {
  locale: string;
  /** null when no judge run parsed — counted against `scoredRate`, nothing else. */
  score: number | null;
  /** false for a reply the rubric is supposed to mark down. */
  expectPass: boolean;
  /**
   * A sample measured and reported but held out of every gated aggregate
   * (ADR-0077). The probe class this exists for is a rubric weakness we have
   * observed once and cannot yet reproduce: putting it in the gated set would
   * make an expected failure a permanent release blocker, since `worstReject`
   * feeds a metric with `rejectMax` and `eval-live` runs on push to `main`.
   *
   * A separate flag rather than a third value of `expectPass`, because
   * `expectPass` is read as a boolean in three aggregates below and `!expectPass`
   * would silently file a diagnostic as a reject — the exact gate it must stay
   * out of.
   */
  diagnostic?: boolean;
}

export interface CxRubricSummary {
  /** Mean of the passing samples, per locale, sorted by locale. */
  perLocale: [string, number][];
  /** Gap between exactly two locales, else null — one language makes no parity claim. */
  parityGap: [string, string, number] | null;
  /** Worst score among the samples that should have been marked down, else null. */
  worstReject: number | null;
  /** Fraction of samples the judge returned a usable score for. */
  scoredRate: number;
  /**
   * Worst score among the `diagnostic` samples, else null. Reported, never
   * gated (ADR-0077) — a max for the same reason `worstReject` is one: the
   * probe asks whether the rubric catches a class at all, and a mean over two
   * languages hides the one that missed it.
   */
  diagnostic: number | null;
}

/**
 * The arithmetic behind the CX gate, kept out of the scorer so it can be tested
 * without a judge. Both halves of the gate share it: the canned `cx-quality`
 * task and the live one, which differ only in where `score` came from.
 *
 * `worstReject` is a max and not a mean on purpose — one hallucinated payout
 * waved through is the failure, and a mean over both languages hides it.
 */
export function cxRubricSummary(samples: readonly CxScoredSample[]): CxRubricSummary {
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  // ADR-0077. Held out here, once, rather than at each of the four aggregates
  // below — `scoredRate` included, since a diagnostic the judge failed to parse
  // is a fact about the probe and not about the gated set.
  const diagnostics = samples.filter((s) => s.diagnostic);
  const gated = samples.filter((s) => !s.diagnostic);

  const byLocale = new Map<string, number[]>();
  for (const s of gated) {
    if (s.score === null || !s.expectPass) continue;
    byLocale.set(s.locale, [...(byLocale.get(s.locale) ?? []), s.score]);
  }
  const perLocale = [...byLocale.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, scores]) => [locale, mean(scores)] as [string, number]);

  const parityGap =
    perLocale.length === 2
      ? ([perLocale[0]![0], perLocale[1]![0], localeGap(perLocale[0]![1], perLocale[1]![1])] as [
          string,
          string,
          number
        ])
      : null;

  const rejects = gated.filter((s) => !s.expectPass && s.score !== null).map((s) => s.score as number);
  const usable = gated.filter((s) => s.score !== null).length;

  const probes = diagnostics.filter((s) => s.score !== null).map((s) => s.score as number);

  return {
    perLocale,
    parityGap,
    worstReject: rejects.length ? Math.max(...rejects) : null,
    scoredRate: gated.length ? usable / gated.length : 1,
    diagnostic: probes.length ? Math.max(...probes) : null
  };
}
