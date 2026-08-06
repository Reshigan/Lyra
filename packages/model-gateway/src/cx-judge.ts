import { stripFence } from "./extract.js";

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
export const CX_JUDGE_VERSION = "cx-rubric-v1";

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
    "Conversation:",
    ...sample.context,
    "",
    "Reply under evaluation:",
    sample.reply,
    "",
    `Answer with JSON only: {${CX_RUBRIC.map((d) => `"${d.name}": <1-5>`).join(", ")}, "why": "<one sentence>"}`
  ].join("\n");
}

/**
 * One judge run to one score, or null if the run is unusable. Null rather than a
 * low score: a judge that returned prose, or dropped a dimension, has told us
 * nothing about the reply — scoring that as a 1 would let a flaky judge fail a
 * good sample.
 */
export function parseCxScore(reply: string): number | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFence(reply)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  let total = 0;
  for (const dimension of CX_RUBRIC) {
    const value = parsed[dimension.name];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    // Out of range means the judge ignored the rubric it was handed. Clamping
    // would hide that; the run is discarded and the median carries the sample.
    if (value < MIN_SCORE || value > MAX_SCORE) return null;
    total += value;
  }
  return total / CX_RUBRIC.length;
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
