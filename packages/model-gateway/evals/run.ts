import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInput, checkOutput, blocked } from "../src/guardrails.js";
import { EXTRACTION_FIELDS, normalizeField, parseExtraction } from "../src/extract.js";
import { verifyNumericClaims, checkCompliance as checkSignalCompliance, type BriefingSnapshot } from "@lyra/core";

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
async function scoreAxis(dir: string): Promise<Metric[]> {
  const cases = await loadCases<AxisCase>(dir);
  const thresholds = await loadThresholds<AxisThresholds>(dir);

  let correct = 0;
  let total = 0;
  for (const c of cases) {
    const fields = EXTRACTION_FIELDS[c.docType] ?? Object.keys(c.expected);
    const { values } = parseExtraction(c.text, fields);
    for (const field of fields) {
      total += 1;
      if (normalizeField(values[field] ?? null) === normalizeField(c.expected[field] ?? null)) correct += 1;
    }
  }

  return [metric("fieldAccuracy", total ? correct / total : 1, { min: thresholds.fieldAccuracyMin })];
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

const SCORERS: Record<string, (dir: string) => Promise<Metric[]>> = {
  injection: scoreInjection,
  compliance: scoreCompliance,
  axis: scoreAxis,
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
