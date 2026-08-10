import { Money } from "@lyra/ui";
// ../api-error, never ../api.server: this module is not a route, so the client
// bundle takes it whole and a `.server` import here is a build error.
import { ApiError } from "../api-error";
import { pseudoText, translator } from "../i18n";

// The half-dozen things every bespoke NORTH screen needs and none of them owns:
// the label resolver, the 403-swallowing read, the action envelope, and the one
// rule for turning a stored snapshot integer into a number a person reads.
//
// Storage formats are not display formats (packages/core/src/narrator-verify.ts
// §displayValue): money is minor units, a percent or ratio is basis points. That
// conversion lives here once so two NORTH screens cannot disagree about it.

export type Labels = Record<string, Record<string, string>>;

/** Locale, then English, then the shell's `common.*` catalogue, then the key. */
export function labelsFrom(
  labels: Labels,
  locale: string
): (key: string, vars?: Record<string, string>) => string {
  const table = labels[locale] ?? labels.en ?? {};
  const fallback = labels.en ?? {};
  const t = translator(locale);
  return (key, vars) => {
    const local = table[key] ?? fallback[key];
    // `t()` pseudoizes on its own; only the route's own table needs the wrap.
    const shared = local === undefined ? t(`common.${key}`) : pseudoText(locale, local);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/**
 * A section the actor may not read is absent, not an error: the API is the
 * authority on what they see, so one withheld permission costs a card rather
 * than the whole screen.
 */
export async function readable<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

/** Every NORTH action answers in this shape; `saved` names what was written. */
export interface ActionResult {
  problem: { title: string; status: number; code?: string; detail?: string; requestId?: string } | null;
  saved: string | null;
}

export const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  saved: null
});

/** `ApiError` → a Problem beside the form it was refused for, never a crash. */
export function refused(error: unknown): ActionResult {
  if (error instanceof ApiError) return { problem: error.problem, saved: null };
  throw error;
}

/** A page of generic-CRUD rows (apps/api/src/crud.ts). */
export interface Page<T> {
  data: T[];
  cursor?: string;
  total?: number;
}

export type MetricUnit = "count" | "money" | "percent" | "ratio" | "duration_ms";

export interface Metric {
  id: string;
  key: string;
  nameJson: string | null;
  definitionSqlRef: string | null;
  unit: MetricUnit;
  currency: string | null;
  grain: "day" | "week" | "month";
  owner: string | null;
  targetJson: string | null;
  sensitivity: string;
  direction: string;
  updatedAt: number;
}

export interface Snapshot {
  id: string;
  metricKey: string;
  grain: string;
  period: string;
  value: number;
  dimsHash: string;
  ts: number;
}

/** The metric's name in this locale, falling back to the key it is stored under. */
export function metricName(metric: Pick<Metric, "key" | "nameJson">, locale: string): string {
  if (!metric.nameJson) return metric.key;
  try {
    const names = JSON.parse(metric.nameJson) as Record<string, string>;
    return names[locale] ?? names.en ?? metric.key;
  } catch {
    return metric.key;
  }
}

/** Parses a JSON column without letting one bad row take the screen down. */
export function parsed<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Basis points → the percent a person reads. `null` when there is no prior. */
export function pct(bps: number | null, locale: string): string | null {
  if (bps === null || !Number.isFinite(bps)) return null;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero"
  }).format(bps / 10_000);
}

/**
 * One stored integer, rendered in its own units. Money goes through `<Money>`
 * so a three-decimal currency is right without this file knowing which ones
 * those are.
 */
export function MetricValue({
  value,
  unit,
  currency,
  locale
}: {
  value: number;
  unit: MetricUnit;
  currency?: string | null;
  locale: string;
}) {
  if (unit === "money" && currency) {
    return <Money amountMinor={value} currency={currency} locale={locale} />;
  }
  const format =
    unit === "percent" || unit === "ratio"
      ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 })
      : unit === "duration_ms"
        ? new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 1 })
        : new Intl.NumberFormat(locale);
  const scaled = unit === "percent" || unit === "ratio" ? value / 10_000 : unit === "duration_ms" ? value / 1_000 : value;
  return <span className="tabular-nums">{format.format(scaled)}</span>;
}
