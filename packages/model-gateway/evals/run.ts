import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInput, checkOutput, blocked } from "../src/guardrails.js";
import { EXTRACTION_FIELDS, normalizeField, parseExtraction } from "../src/extract.js";
import { aggregateCxScore, localeGap } from "../src/cx-judge.js";
import { verifyNumericClaims, verifyGroundedness, checkCompliance as checkSignalCompliance, type BriefingSnapshot } from "@lyra/core";

// docs/13 §3 (Eval-driven development): the golden set + threshold is the
// failing test for model/guardrail behaviour. One task = one directory under
// evals/ with cases.jsonl + thresholds.json; `pnpm eval` runs every task it
// finds a scorer for and fails the gate on any missed threshold.

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));

interface Metric {
  name: string;
  value: number;
  /** -Infinity when the metric has no lower bound. */
  min: number;
  /** Infinity when the metric has no upper bound. */
  max: number;
}

function metric(name: string, value: number, bound: { min?: number; max?: number }): Metric {
  return { name, value, min: bound.min ?? -Infinity, max: bound.max ?? Infinity };
}

function metricOk(m: Metric): boolean {
  return m.value >= m.min && m.value <= m.max;
}

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

interface AxisCopilotCase {
  id: string;
  contextLines: string[];
  text: string;
  expectOk: boolean;
}
interface AxisCopilotThresholds {
  recallMin: number;
  falsePositiveMax: number;
}

async function scoreAxisCopilot(dir: string): Promise<Metric[]> {
  const cases = await loadCases<AxisCopilotCase>(dir);
  const thresholds = await loadThresholds<AxisCopilotThresholds>(dir);
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
  compliance: scoreCompliance,
  axis: scoreAxis,
  "axis-copilot": scoreAxisCopilot,
  "cx-quality": scoreCxQuality,
  north: scoreNorth,
  signal: scoreSignal
};

async function loadCases<T>(dir: string): Promise<T[]> {
  const raw = await readFile(join(dir, "cases.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function loadThresholds<T>(dir: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, "thresholds.json"), "utf8")) as T;
}

async function main(): Promise<void> {
  const tasks = (await readdir(EVALS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  let failed = false;

  for (const task of tasks) {
    const scorer = SCORERS[task];
    if (!scorer) {
      console.log(`skip ${task}: no scorer registered in evals/run.ts`);
      continue;
    }
    const metrics = await scorer(join(EVALS_DIR, task));
    console.log(`\n${task}`);
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
