import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInput, checkOutput, blocked } from "../src/guardrails.js";
import { EXTRACTION_FIELDS, normalizeField, parseExtraction, parseVisionExtraction } from "../src/extract.js";
import { parseTriage } from "../src/triage.js";
import { parseReserve } from "../src/reserve.js";
import { parseFraud } from "../src/fraud.js";
import { parseSla } from "../src/sla.js";
import { aggregateCxScore, localeGap } from "../src/cx-judge.js";
import { verifyNumericClaims, verifyGroundedness, checkCompliance as checkSignalCompliance, type BriefingSnapshot } from "@lyra/core";
import { loadCases, loadThresholds, metric, metricOk, type Metric } from "./harness.js";
import { LIVE_SCORERS } from "./live.js";

// docs/13 §3 (Eval-driven development): the golden set + threshold is the
// failing test for model/guardrail behaviour. One task = one directory under
// evals/ with cases.jsonl + thresholds.json; `pnpm eval` runs every task it
// finds a scorer for and fails the gate on any missed threshold.

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));

interface InjectionCase {
  id: string;
  text: string;
  expectHit: boolean;
}

interface InjectionThresholds {
  recallMin: number;
  falsePositiveMax: number;
}

async function scoreInjection(dir: string): Promise<Metric[]> {
  const cases = await loadCases<InjectionCase>(dir);
  const thresholds = await loadThresholds<InjectionThresholds>(dir);
  const positives = cases.filter((c) => c.expectHit);
  const negatives = cases.filter((c) => !c.expectHit);

  const truePositives = positives.filter((c) => checkInput(c.text).length > 0).length;
  const falsePositives = negatives.filter((c) => checkInput(c.text).length > 0).length;

  return [
    metric("recall", positives.length ? truePositives / positives.length : 1, { min: thresholds.recallMin }),
    metric("falsePositiveRate", negatives.length ? falsePositives / negatives.length : 0, {
      max: thresholds.falsePositiveMax
    })
  ];
}

interface ComplianceCase {
  id: string;
  text: string;
  customerFacing: boolean;
  issued: string[];
  expectBlock: boolean;
  expectRule: string | null;
}

interface ComplianceThresholds {
  hardBlockRecallMin: number;
  falsePositiveMax: number;
  ruleMatchMin: number;
}

async function scoreCompliance(dir: string): Promise<Metric[]> {
  const cases = await loadCases<ComplianceCase>(dir);
  const thresholds = await loadThresholds<ComplianceThresholds>(dir);
  const blockCases = cases.filter((c) => c.expectBlock);
  const cleanCases = cases.filter((c) => !c.expectBlock);
  const ruleCases = cases.filter((c) => c.expectRule);

  const results = cases.map((c) => ({
    case: c,
    hits: checkOutput({ text: c.text, issued: new Set(c.issued), customerFacing: c.customerFacing })
  }));

  const correctlyBlocked = results.filter((r) => r.case.expectBlock && blocked(r.hits)).length;
  const falseBlocks = results.filter((r) => !r.case.expectBlock && blocked(r.hits)).length;
  const ruleMatches = results.filter(
    (r) => r.case.expectRule && r.hits.some((h) => h.rule === r.case.expectRule)
  ).length;

  return [
    metric("hardBlockRecall", blockCases.length ? correctlyBlocked / blockCases.length : 1, {
      min: thresholds.hardBlockRecallMin
    }),
    metric("falsePositiveRate", cleanCases.length ? falseBlocks / cleanCases.length : 0, {
      max: thresholds.falsePositiveMax
    }),
    metric("ruleMatchRate", ruleCases.length ? ruleMatches / ruleCases.length : 1, { min: thresholds.ruleMatchMin })
  ];
}

interface AxisCase {
  id: string;
  docType: string;
  locale: string;
  /** The model's structured reply — what `parseExtraction` (src/extract.ts) actually parses. */
  text: string;
  expected: Record<string, string>;
}

interface AxisThresholds {
  fieldAccuracyMin: number;
}

// docs/modules/axis.md §8: "EID + mulkiya extraction >= 95% field accuracy on
// test set (both languages)". No live model call here (evals stay
// deterministic/CI-safe, docs/13 §4) — cases.jsonl bakes in canned model
// replies (clean, code-fenced, missing/whitespace/case-noise) and this scores
// the exact `parseExtraction` the /documents/:id/extract route runs.
//
// Scored per locale, never pooled: docs/13 §3.3 reads "field-F1 >= 0.95 (ar+en
// separately)" precisely because a pooled number lets a strong English set
// carry a failing Arabic one. Whatever locales the cases carry become metrics —
// adding a third language adds its own gate rather than diluting the other two.
// Splitting them exposed exactly that: the authored failure modes (an omitted
// field, a transposed digit) sat only in the English cases, so a clean Arabic
// set was carrying English past the bar. Keep the sets symmetric — every
// failure mode one locale carries, the other carries too, or the parity number
// measures the golden set rather than the extractor.
async function scoreAxis(dir: string): Promise<Metric[]> {
  const cases = await loadCases<AxisCase>(dir);
  const thresholds = await loadThresholds<AxisThresholds>(dir);

  const tally = new Map<string, { correct: number; total: number }>();
  for (const c of cases) {
    const fields = EXTRACTION_FIELDS[c.docType] ?? Object.keys(c.expected);
    const { values } = parseExtraction(c.text, fields);
    const t = tally.get(c.locale) ?? { correct: 0, total: 0 };
    for (const field of fields) {
      t.total += 1;
      if (normalizeField(values[field] ?? null) === normalizeField(c.expected[field] ?? null)) t.correct += 1;
    }
    tally.set(c.locale, t);
  }

  return [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, t]) =>
      metric(`fieldAccuracy.${locale}`, t.total ? t.correct / t.total : 1, {
        min: thresholds.fieldAccuracyMin
      })
    );
}

interface AxisVisionCase {
  id: string;
  docType: string;
  /** The doc type actually on the rendered page — equal to docType except in the routing cases below. */
  actualDocType: string;
  locale: string;
  /** The model's structured reply — what `parseVisionExtraction` (src/extract.ts) actually parses. */
  text: string;
  expected: Record<string, string | null>;
}

interface AxisVisionThresholds {
  fieldAccuracyMin: number;
  pageRoutingAccuracyMin: number;
  hallucinatedFieldRateMax: number;
}

// docs/specs/gap-axis-design.md §G.5: fieldAccuracyMin carries over from
// scoreAxis but is now measured through parseVisionExtraction end-to-end from
// the image, not from supplied text. The route never asks the model to
// classify the doc type (apps/api/src/routes/axis.ts picks `before.docType`
// off the DB row before the call) — so pageRoutingAccuracy is scored as
// correct abstention: when docType != actualDocType (an intake mis-tag), every
// field must come back null rather than fabricate a match. hallucinatedFieldRate
// covers the partial-evidence guard in parseVisionExtraction (a value missing
// its page or bbox is forced null) — full-fabrication (a wrong value with
// complete, self-consistent evidence) has no ground truth to check
// deterministically and is left to the live eval (evals/live.ts).
async function scoreAxisVision(dir: string): Promise<Metric[]> {
  const cases = await loadCases<AxisVisionCase>(dir);
  const thresholds = await loadThresholds<AxisVisionThresholds>(dir);

  const tally = new Map<string, { correct: number; total: number }>();
  let hallucinated = 0;
  let nullOpportunities = 0;
  let mismatched = 0;
  let routedCorrectly = 0;

  for (const c of cases) {
    const fields = EXTRACTION_FIELDS[c.docType] ?? Object.keys(c.expected);
    const { values } = parseVisionExtraction(c.text, fields);

    if (c.docType === c.actualDocType) {
      const t = tally.get(c.locale) ?? { correct: 0, total: 0 };
      for (const field of fields) {
        t.total += 1;
        if (normalizeField(values[field]?.value ?? null) === normalizeField(c.expected[field] ?? null)) {
          t.correct += 1;
        }
      }
      tally.set(c.locale, t);
    } else {
      mismatched += 1;
      if (fields.every((field) => values[field]?.value === null)) routedCorrectly += 1;
    }

    for (const field of fields) {
      if (c.expected[field] !== null) continue;
      nullOpportunities += 1;
      if (values[field]?.value !== null) hallucinated += 1;
    }
  }

  const metrics = [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, t]) =>
      metric(`fieldAccuracy.${locale}`, t.total ? t.correct / t.total : 1, { min: thresholds.fieldAccuracyMin })
    );

  metrics.push(
    metric("pageRoutingAccuracy", mismatched ? routedCorrectly / mismatched : 1, {
      min: thresholds.pageRoutingAccuracyMin
    })
  );
  metrics.push(
    metric("hallucinatedFieldRate", nullOpportunities ? hallucinated / nullOpportunities : 0, {
      max: thresholds.hallucinatedFieldRateMax
    })
  );

  return metrics;
}

interface FnolTriageCase {
  id: string;
  /** The model's structured reply — what `parseTriage` (src/triage.ts) actually parses. */
  text: string;
  expected: { perilCode: string | null; causeCode: string | null; complexity: string | null };
}

interface FnolTriageThresholds {
  fieldAccuracyMin: number;
}

const TRIAGE_FIELDS = ["perilCode", "causeCode", "complexity"] as const;

// docs/specs/gap-axis-design.md §G.1. No live model call (deterministic/CI-safe,
// docs/13 §4) — cases.jsonl bakes in canned model replies (clean, code-fenced,
// missing field, invalid enum value) and this scores the exact `parseTriage`
// that `triageFnol` (apps/api/src/engines/axis-fnol.ts) runs in production.
async function scoreFnolTriage(dir: string): Promise<Metric[]> {
  const cases = await loadCases<FnolTriageCase>(dir);
  const thresholds = await loadThresholds<FnolTriageThresholds>(dir);

  let correct = 0;
  let total = 0;
  for (const c of cases) {
    const triage = parseTriage(c.text);
    for (const field of TRIAGE_FIELDS) {
      total += 1;
      if (normalizeField(triage[field]) === normalizeField(c.expected[field])) correct += 1;
    }
  }

  return [metric("fieldAccuracy", total ? correct / total : 1, { min: thresholds.fieldAccuracyMin })];
}

interface ReserveCase {
  id: string;
  /** The model's structured reply — what `parseReserve` (src/reserve.ts) actually parses. */
  text: string;
  /** Ground truth the recommendation is scored against — what the claim actually settled for. */
  actualSettledMinor: number;
}

interface ReserveThresholds {
  medianAbsPctErrorMax: number;
  bandCoverageMin: number;
  overReserveBiasMax: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// docs/specs/gap-axis-design.md §G.3. No live model call (deterministic/CI-safe,
// docs/13 §4) — cases.jsonl bakes in canned model replies (clean, code-fenced,
// missing band, inverted band, extra properties, wrong types) plus each case's
// actual settled amount, scoring the exact `parseReserve` that
// `recommendReserve` (apps/api/src/engines/axis-reserve-advisor.ts) runs in production.
async function scoreReserve(dir: string): Promise<Metric[]> {
  const cases = await loadCases<ReserveCase>(dir);
  const thresholds = await loadThresholds<ReserveThresholds>(dir);

  const pctErrors: number[] = [];
  const biases: number[] = [];
  let bandedCases = 0;
  let covered = 0;

  for (const c of cases) {
    const rec = parseReserve(c.text);
    if (rec.recommendedMinor !== null && c.actualSettledMinor > 0) {
      pctErrors.push(Math.abs(rec.recommendedMinor - c.actualSettledMinor) / c.actualSettledMinor);
      biases.push((rec.recommendedMinor - c.actualSettledMinor) / c.actualSettledMinor);
    }
    if (rec.band) {
      bandedCases += 1;
      if (c.actualSettledMinor >= rec.band[0] && c.actualSettledMinor <= rec.band[1]) covered += 1;
    }
  }

  return [
    metric("medianAbsPctError", pctErrors.length ? median(pctErrors) : 1, { max: thresholds.medianAbsPctErrorMax }),
    metric("bandCoverage", bandedCases ? covered / bandedCases : 0, { min: thresholds.bandCoverageMin }),
    metric("overReserveBias", biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : 0, {
      max: thresholds.overReserveBiasMax
    })
  ];
}

interface FraudCase {
  id: string;
  text: string;
  expectFraud: boolean;
  cohort: string;
}

interface FraudThresholds {
  precisionAtTop10Min: number;
  recallMin: number;
  unexplainedIndicatorRateMax: number;
  maxScoreDeltaByProtectedProxy: number;
}

// docs/specs/gap-axis-design.md §G.2. Mirrors apps/api/src/engines/axis-fraud-scorer.ts's
// SIU_REFERRAL_THRESHOLD — recall is measured at the same cutoff production uses to
// open a referral, not at some other cutoff that would score a different behaviour.
const SIU_REFERRAL_THRESHOLD = 60;

// No live model call (docs/13 §4) — cases.jsonl bakes in canned model replies plus
// each case's ground truth, scoring the exact `parseFraud` that
// scoreAndReferClaim (apps/api/src/engines/axis-fraud-scorer.ts) runs in production.
async function scoreFraud(dir: string): Promise<Metric[]> {
  const cases = await loadCases<FraudCase>(dir);
  const thresholds = await loadThresholds<FraudThresholds>(dir);

  const scored = cases.map((c) => ({ case: c, result: parseFraud(c.text) }));

  const top10 = [...scored].sort((a, b) => b.result.score - a.result.score).slice(0, 10);
  const precisionAtTop10 = top10.length ? top10.filter((s) => s.case.expectFraud).length / top10.length : 0;

  const positives = scored.filter((s) => s.case.expectFraud);
  const referred = positives.filter((s) => s.result.score >= SIU_REFERRAL_THRESHOLD).length;
  const recall = positives.length ? referred / positives.length : 1;

  // Rate is over raw indicator candidates, not the already-filtered `indicators`
  // array — parseFraud can never leave an unlinked indicator in that array by
  // construction, so measuring against it would report a permanent zero regardless
  // of how often the drop actually fires.
  let candidates = 0;
  let dropped = 0;
  for (const { result } of scored) {
    dropped += result.droppedIndicatorCount;
    candidates += result.indicators.length + result.droppedIndicatorCount;
  }
  const unexplainedIndicatorRate = candidates ? dropped / candidates : 0;

  const metrics = [
    metric("precisionAtTop10", precisionAtTop10, { min: thresholds.precisionAtTop10Min }),
    metric("recall", recall, { min: thresholds.recallMin }),
    metric("unexplainedIndicatorRate", unexplainedIndicatorRate, { max: thresholds.unexplainedIndicatorRateMax })
  ];

  // Fairness is a claim about equal treatment of otherwise-similar claims, not
  // about whether genuinely fraudulent claims score high — so it's measured on
  // the clean cohort only (mirrors scoreCxQuality's "only when >=2 groups" gate).
  const byCohort = new Map<string, number[]>();
  for (const { case: c, result } of scored) {
    if (c.expectFraud) continue;
    byCohort.set(c.cohort, [...(byCohort.get(c.cohort) ?? []), result.score]);
  }
  const cohorts = [...byCohort.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (cohorts.length >= 2) {
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const means = cohorts.map(([, scores]) => mean(scores));
    const delta = Math.max(...means) - Math.min(...means);
    metrics.push(metric("maxScoreDeltaByProtectedProxy", delta, { max: thresholds.maxScoreDeltaByProtectedProxy }));
  }

  return metrics;
}

interface SlaCase {
  id: string;
  text: string;
  expectBreach: boolean;
  /** Hours remaining until the case's actual SLA deadline at the moment the prediction fired. */
  hoursToBreachAtPrediction: number;
}

interface SlaThresholds {
  aucMin: number;
  calibrationErrorMax: number;
  leadTimeMedianHoursMin: number;
}

// docs/specs/gap-axis-design.md §G.4 — same alert cutoff a Prioritiser/Chaser
// would eventually key off of; scored here purely to compute lead time.
const BREACH_ALERT_THRESHOLD = 50;

// No live model call (docs/13 §4), same as scoreFraud/scoreReserve — cases.jsonl
// bakes in canned model replies plus ground truth, scoring the exact `parseSla`
// that predictSlaBreach (apps/api/src/engines/axis-sla-sentinel.ts) runs in production.
async function scoreSla(dir: string): Promise<Metric[]> {
  const cases = await loadCases<SlaCase>(dir);
  const thresholds = await loadThresholds<SlaThresholds>(dir);

  const scored = cases.map((c) => ({ case: c, result: parseSla(c.text) }));

  const positives = scored.filter((s) => s.case.expectBreach);
  const negatives = scored.filter((s) => !s.case.expectBreach);
  let concordant = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p.result.breachProbability > n.result.breachProbability) concordant += 1;
      else if (p.result.breachProbability === n.result.breachProbability) concordant += 0.5;
    }
  }
  const total = positives.length * negatives.length;
  const auc = total ? concordant / total : 1;

  const byPrediction = [...scored].sort((a, b) => a.result.breachProbability - b.result.breachProbability);
  const bucketSize = Math.max(1, Math.ceil(byPrediction.length / 10));
  const bucketErrors: number[] = [];
  for (let i = 0; i < byPrediction.length; i += bucketSize) {
    const bucket = byPrediction.slice(i, i + bucketSize);
    const meanPredicted = bucket.reduce((sum, s) => sum + s.result.breachProbability, 0) / bucket.length / 100;
    const observedBreachRate = bucket.filter((s) => s.case.expectBreach).length / bucket.length;
    bucketErrors.push(Math.abs(meanPredicted - observedBreachRate));
  }
  const calibrationError = bucketErrors.length ? bucketErrors.reduce((a, b) => a + b, 0) / bucketErrors.length : 0;

  const leadTimes = positives
    .filter((s) => s.result.breachProbability >= BREACH_ALERT_THRESHOLD)
    .map((s) => s.case.hoursToBreachAtPrediction);
  const leadTimeMedianHours = leadTimes.length ? median(leadTimes) : 0;

  return [
    metric("auc", auc, { min: thresholds.aucMin }),
    metric("calibrationError", calibrationError, { max: thresholds.calibrationErrorMax }),
    metric("leadTimeMedianHours", leadTimeMedianHours, { min: thresholds.leadTimeMedianHoursMin })
  ];
}

interface CxQualityCase {
  id: string;
  locale: string;
  context: string[];
  reply: string;
  /** One entry per judge run — `CX_JUDGE_SAMPLES` of them (docs/13 §3.4). */
  judgeReplies: string[];
}

interface CxQualityThresholds {
  rubricMin: number;
  parityGapMax: number;
  /** Fraction of samples that must produce a usable score at all. */
  scoredMin: number;
}

// docs/13 §3.3: "CX quality rubric >= 4.2/5 (ar+en separately — parity gap
// <= 0.2)". Scores the exact judge in packages/model-gateway/src/cx-judge.ts.
// The judge replies are canned for the same reason the axis model replies are:
// a gate that calls a live model is not a gate. The live weekly re-score
// (docs/12 §4) runs the same rubric against sampled production conversations.
async function scoreCxQuality(dir: string): Promise<Metric[]> {
  const cases = await loadCases<CxQualityCase>(dir);
  const thresholds = await loadThresholds<CxQualityThresholds>(dir);

  const byLocale = new Map<string, number[]>();
  let scored = 0;
  for (const c of cases) {
    const score = aggregateCxScore(c.judgeReplies);
    if (score === null) continue;
    scored += 1;
    byLocale.set(c.locale, [...(byLocale.get(c.locale) ?? []), score]);
  }

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const locales = [...byLocale.entries()].sort(([a], [b]) => a.localeCompare(b));
  const metrics = locales.map(([locale, scores]) =>
    metric(`rubric.${locale}`, mean(scores), { min: thresholds.rubricMin })
  );

  // The gap is only meaningful between two languages; with one locale in the
  // set there is no parity claim to make, so the metric stays off rather than
  // reporting a flattering zero.
  if (locales.length === 2) {
    const [a, b] = locales as [[string, number[]], [string, number[]]];
    metrics.push(
      metric(`parityGap.${a[0]}-${b[0]}`, localeGap(mean(a[1]), mean(b[1])), {
        max: thresholds.parityGapMax
      })
    );
  }

  // A judge that stops returning parseable scores would otherwise show up as a
  // suspiciously good run over the handful of samples that still worked.
  metrics.push(metric("scoredRate", cases.length ? scored / cases.length : 1, { min: thresholds.scoredMin }));
  return metrics;
}

interface NorthCase {
  id: string;
  snapshot: BriefingSnapshot;
  text: string;
  expectOk: boolean;
}

interface NorthThresholds {
  recallMin: number;
  falsePositiveMax: number;
}

// docs/15 §4 inspectability gate for NORTH briefings: every number the model
// writes must trace back to the snapshot. Scores the exact `verifyNumericClaims`
// packages/core/src/narrator-verify.ts exports — the same function
// apps/api/src/engines/narrator.ts runs post-generation, so this eval and
// production share one implementation (docs/13 §3, no scorer duplicate).
async function scoreNorth(dir: string): Promise<Metric[]> {
  const cases = await loadCases<NorthCase>(dir);
  const thresholds = await loadThresholds<NorthThresholds>(dir);
  const violations = cases.filter((c) => !c.expectOk);
  const clean = cases.filter((c) => c.expectOk);

  const caught = violations.filter((c) => !verifyNumericClaims(c.text, c.snapshot).ok).length;
  const falseFlags = clean.filter((c) => !verifyNumericClaims(c.text, c.snapshot).ok).length;

  return [
    metric("recall", violations.length ? caught / violations.length : 1, { min: thresholds.recallMin }),
    metric("falsePositiveRate", clean.length ? falseFlags / clean.length : 0, { max: thresholds.falsePositiveMax })
  ];
}

interface SignalCase {
  id: string;
  text: string;
  expectFlag: boolean;
  expectRule: string | null;
}

interface SignalThresholds {
  hardBlockRecallMin: number;
  falsePositiveMax: number;
}

// docs/modules/signal.md §2.1 Compliance Pre-flight: scores the exact
// `checkCompliance` packages/core/src/signal-compliance.ts exports — the same
// function apps/api/src/engines/signal-creative.ts runs per generated variant,
// so this eval and production share one implementation (docs/13 §3).
async function scoreSignal(dir: string): Promise<Metric[]> {
  const cases = await loadCases<SignalCase>(dir);
  const thresholds = await loadThresholds<SignalThresholds>(dir);
  const flagged = cases.filter((c) => c.expectFlag);
  const clean = cases.filter((c) => !c.expectFlag);

  const caught = flagged.filter((c) => checkSignalCompliance(c.text).status === "flagged").length;
  const falseFlags = clean.filter((c) => checkSignalCompliance(c.text).status === "flagged").length;

  return [
    metric("hardBlockRecall", flagged.length ? caught / flagged.length : 1, { min: thresholds.hardBlockRecallMin }),
    metric("falsePositiveRate", clean.length ? falseFlags / clean.length : 0, { max: thresholds.falsePositiveMax })
  ];
}

interface GroundednessCase {
  id: string;
  contextLines: string[];
  text: string;
  expectOk: boolean;
}
interface GroundednessThresholds {
  recallMin: number;
  falsePositiveMax: number;
}

/**
 * The gate for any surface whose rule is "state no number the context did not
 * give you". Two golden sets run through it: AXIS's case copilot
 * (routes/axis.ts) and ORBIT's reply drafter (engines/orbit-draft.ts), both of
 * which call verifyGroundedness over their own context lines before a human
 * ever sees the text — one scorer, because it is one function being scored.
 */
async function scoreGroundedness(dir: string): Promise<Metric[]> {
  const cases = await loadCases<GroundednessCase>(dir);
  const thresholds = await loadThresholds<GroundednessThresholds>(dir);
  const violations = cases.filter((c) => !c.expectOk);
  const clean = cases.filter((c) => c.expectOk);
  const caught = violations.filter((c) => !verifyGroundedness(c.text, c.contextLines).ok).length;
  const falseFlags = clean.filter((c) => !verifyGroundedness(c.text, c.contextLines).ok).length;
  return [
    metric("recall", violations.length ? caught / violations.length : 1, { min: thresholds.recallMin }),
    metric("falsePositiveRate", clean.length ? falseFlags / clean.length : 0, { max: thresholds.falsePositiveMax })
  ];
}

const SCORERS: Record<string, (dir: string) => Promise<Metric[]>> = {
  injection: scoreInjection,
  "creative-image": scoreInjection,
  compliance: scoreCompliance,
  axis: scoreAxis,
  "axis-vision": scoreAxisVision,
  "axis-copilot": scoreGroundedness,
  "orbit-draft": scoreGroundedness,
  "axis-fnol-triage": scoreFnolTriage,
  "axis-reserve": scoreReserve,
  "axis-fraud": scoreFraud,
  "axis-sla": scoreSla,
  "cx-quality": scoreCxQuality,
  north: scoreNorth,
  signal: scoreSignal
};

async function main(): Promise<void> {
  const tasks = (await readdir(EVALS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const live = process.env["LYRA_EVAL_LIVE"] === "1";

  let failed = false;

  for (const task of tasks) {
    const isLive = Boolean(LIVE_SCORERS[task]);
    if (isLive && !live) {
      console.log(`\n${task}\n  skipped: live eval, run \`pnpm eval:live\` (LYRA_EVAL_LIVE=1)`);
      continue;
    }
    const scorer = SCORERS[task] ?? LIVE_SCORERS[task];
    if (!scorer) {
      // docs/27 F10: a golden set nobody scores is worse than no golden set —
      // it reads as coverage. An unregistered directory fails the gate.
      console.error(`\n${task}\n  FAIL no scorer registered in evals/run.ts or evals/live.ts`);
      failed = true;
      continue;
    }
    console.log(`\n${task}`);
    let metrics: Metric[];
    try {
      metrics = await scorer(join(EVALS_DIR, task));
    } catch (err) {
      // Includes "live requested but no credentials": with the flag on, a run
      // that cannot reach a model is a failure, never a silent pass.
      console.error(`  FAIL ${(err as Error).message}`);
      failed = true;
      continue;
    }
    for (const m of metrics) {
      const ok = metricOk(m);
      if (!ok) failed = true;
      const bound = m.min > -Infinity ? `>= ${m.min}` : `<= ${m.max}`;
      console.log(`  ${ok ? "PASS" : "FAIL"} ${m.name} = ${m.value.toFixed(3)} (need ${bound})`);
    }
  }

  if (failed) {
    console.error("\neval gate: FAILED");
    process.exit(1);
  }
  console.log("\neval gate: passed");
}

main();
