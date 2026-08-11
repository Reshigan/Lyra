// The reasoning behind the journey screens, kept out of the screens themselves
// so it can be tested without a renderer. Everything here is pure: it takes API
// rows and answers what to show. Nothing decides what is *allowed* — the API
// owns permissions, approvals and audit (CLAUDE.md rules 3, 4).

import type { Row } from "./api";
import { humanize } from "./rows";

/* ------------------------------------------------------------------- brief */

export interface Highlight {
  metricKey: string;
  period: string;
  value: number;
  deltaBps: number | null;
}

/**
 * The briefing being read: the one asked for, else the most recent. Same rule
 * as the web brief (apps/web/app/routes/north-brief.tsx `chosen`), so the two
 * surfaces never disagree about which briefing "today's" means.
 */
export function chosenBriefing(rows: readonly Row[] | null, id?: string | null): Row | null {
  if (!rows?.length) return null;
  return (id ? rows.find((row) => row.id === id) : undefined) ?? rows[0]!;
}

/** `highlights_json` as rows. Unparseable JSON shows as no highlights rather
 *  than as a crashed screen — a bad column must not cost the whole briefing. */
export function highlightsOf(json: unknown): Highlight[] {
  if (typeof json !== "string" || !json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const h = item as Partial<Highlight>;
    if (typeof h.metricKey !== "string" || typeof h.value !== "number") return [];
    return [
      {
        metricKey: h.metricKey,
        period: typeof h.period === "string" ? h.period : "",
        value: h.value,
        deltaBps: typeof h.deltaBps === "number" ? h.deltaBps : null
      }
    ];
  });
}

/**
 * The anomaly worth interrupting a read for: unowned, and the largest deviation
 * of those. Anything explained or actioned is already somebody's job.
 */
export function unownedAnomaly(rows: readonly Row[] | null): Row | null {
  const open = (rows ?? []).filter((row) => row.state === "new" && !row.explainedBy);
  if (!open.length) return null;
  return open.reduce((worst, row) => (magnitudeOf(row) > magnitudeOf(worst) ? row : worst));
}

const magnitudeOf = (row: Row): number =>
  typeof row.magnitude === "number" ? Math.abs(row.magnitude) : 0;

/** Basis points as a signed percentage: 250 → "+2.5%". */
export function bps(value: number | null): string | null {
  if (value === null) return null;
  const pct = value / 100;
  return `${value > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Today in the API's date form (YYYY-MM-DD), in the device's own timezone —
 *  an executive asking for "today" means their today, not UTC's. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* --------------------------------------------------------------- approvals */

/**
 * What an approval is about, for someone holding a phone. `policyKey` is the
 * only field every approval carries, and it reads as a machine string
 * ("signal.budget.move"), so it becomes words. The subject reference is shown
 * separately as the thing being decided.
 */
export function approvalTitle(row: Row): string {
  const key = typeof row.policyKey === "string" ? row.policyKey : "";
  return key ? key.split(".").map(humanize).join(" · ") : humanize(String(row.id ?? ""));
}

/** The amount an approval turns on, when its context carries one — the single
 *  number a deciding user needs before they can answer. */
export function approvalAmountMinor(row: Row): number | null {
  if (typeof row.contextJson !== "string") return null;
  try {
    const context = JSON.parse(row.contextJson) as { amountMinor?: unknown };
    return typeof context.amountMinor === "number" ? context.amountMinor : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- threads */

/** A conversation's messages oldest-first — the order a thread is read in.
 *  The API sorts by id, which is not the same as by timestamp for messages
 *  written in the same millisecond by different writers. */
export function threadOrder(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => tsOf(a) - tsOf(b));
}

const tsOf = (row: Row): number => (typeof row.ts === "number" ? row.ts : 0);

/** True when the message came from the customer, which is the side of the
 *  thread that gets the plain (not accented) bubble. */
export function isInbound(row: Row): boolean {
  return row.role === "customer";
}

/* ------------------------------------------------------------------- queue */

/** The case states that still owe somebody work (apps/web/app/routes/
 *  axis-exceptions.tsx STUCK_CASE_STATUSES). Issued, failed and cancelled
 *  cases are nobody's queue. */
export const OPEN_CASE_STATUSES = ["intake", "quoting", "awaiting_docs", "review", "approval"] as const;

export type CaseSeverity = "breach" | "urgent" | "due" | "normal";

/**
 * How loudly one case reads, matching the web queue exactly
 * (axis-exceptions.tsx `severityOf`) so the two surfaces never rank the same
 * case differently. The deadline beats the label: a `normal` case past its SLA
 * is worse than an `urgent` one due tomorrow.
 */
export function caseSeverity(
  row: Readonly<Record<string, unknown>>,
  now: number,
  soonMs = 24 * 60 * 60 * 1000
): CaseSeverity {
  const due = typeof row.slaDueAt === "number" ? row.slaDueAt : null;
  if (due !== null && due < now) return "breach";
  if (row.priority === "urgent") return "urgent";
  if (due !== null && due - now <= soonMs) return "due";
  return "normal";
}

const SEVERITY_RANK: Record<CaseSeverity, number> = { breach: 0, urgent: 1, due: 2, normal: 3 };

/** Worst first, then earliest deadline, then oldest. Total and deterministic. */
export function byCaseSeverity(now: number) {
  return (a: Row, b: Row): number => {
    const rank = SEVERITY_RANK[caseSeverity(a, now)] - SEVERITY_RANK[caseSeverity(b, now)];
    if (rank !== 0) return rank;
    const due = numberOr(a.slaDueAt, Number.MAX_SAFE_INTEGER) - numberOr(b.slaDueAt, Number.MAX_SAFE_INTEGER);
    return due !== 0 ? due : numberOr(a.createdAt, 0) - numberOr(b.createdAt, 0);
  };
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" ? value : fallback;

/** The queue in reading order — and, on the SLA tab, only the cases a deadline
 *  is actually pressing on. */
export function queueOrder(rows: readonly Row[] | null, now: number, slaOnly = false): Row[] {
  const kept = (rows ?? []).filter(
    (row) => !slaOnly || caseSeverity(row, now) === "breach" || caseSeverity(row, now) === "due"
  );
  return kept.sort(byCaseSeverity(now));
}

/** A deadline as one coarse unit of time, signed by which side of now it is on.
 *  Precision nobody acts on is noise, so hours and days is as fine as it goes. */
export function dueIn(slaDueAt: unknown, now: number): { overdue: boolean; hours: number } | null {
  if (typeof slaDueAt !== "number") return null;
  const delta = slaDueAt - now;
  return { overdue: delta < 0, hours: Math.max(1, Math.round(Math.abs(delta) / 3_600_000)) };
}

/* ----------------------------------------------------------------- capture */

/** The document types AXIS accepts (apps/api/src/routes/axis.ts DOC_TYPES).
 *  Sending anything else is a 400, so the screen offers exactly these. */
export const DOC_TYPES = ["eid", "mulkiya", "census", "medical", "tradelicense", "other"] as const;

export type DocType = (typeof DOC_TYPES)[number];

/** A captured file's content type from its uri, since the picker does not
 *  always report one. Unknown extensions fall back to JPEG — what every phone
 *  camera on both platforms actually produces. */
export function contentTypeOf(uri: string): string {
  const ext = uri.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}
