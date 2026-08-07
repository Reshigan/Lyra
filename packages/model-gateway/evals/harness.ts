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

export function metricOk(m: Metric): boolean {
  return m.value >= m.min && m.value <= m.max;
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
