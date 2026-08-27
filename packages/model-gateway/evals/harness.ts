import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Shared shapes for every eval task, so the deterministic scorers (run.ts) and
// the live ones (live.ts) report and load the same way.

export interface Metric {
  name: string;
  value: number;
  /** -Infinity when the metric has no lower bound. */
  min: number;
  /** Infinity when the metric has no upper bound. */
  max: number;
}

export function metric(name: string, value: number, bound: { min?: number; max?: number }): Metric {
  return { name, value, min: bound.min ?? -Infinity, max: bound.max ?? Infinity };
}

/** The precision every metric is reported at (run.ts `value.toFixed(REPORTED_DP)`). */
export const REPORTED_DP = 3;

/**
 * Compared at the precision the metric is reported at, because a gate that
 * fails a run it prints as passing is unreadable.
 *
 * Every metric here is a ratio or a mean, and neither lands on a binary
 * fraction: the CX parity gap is |a/5 - b/5| over integer rubric scores, so a
 * one-point difference is 0.20000000000000018, not 0.2. That failed
 * `parityGapMax: 0.2` by 1.8e-16 and printed `FAIL parityGap.ar-en = 0.200
 * (need <= 0.2)` — a live eval blocked the deploy of two unrelated web fixes.
 *
 * This is not slack in the threshold: 0.2005 still fails. It is the bound
 * applied where the number is actually defined. A metric that needs finer
 * resolution needs a finer report first.
 */
export function metricOk(m: Metric): boolean {
  const value = Number(m.value.toFixed(REPORTED_DP));
  return value >= Number(m.min.toFixed(REPORTED_DP)) && value <= Number(m.max.toFixed(REPORTED_DP));
}

export async function loadCases<T>(dir: string): Promise<T[]> {
  const raw = await readFile(join(dir, "cases.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function loadThresholds<T>(dir: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, "thresholds.json"), "utf8")) as T;
}
