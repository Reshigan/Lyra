import { ApiError } from "../api-error";
import type { Problem } from "../api-error";
import { labelsFrom as kitLabelsFrom } from "./detail-kit";

// Six ORBIT screens share the same eight lines of plumbing: a bilingual label
// table, a read that survives a withheld permission, and a page envelope from
// the generic CRUD lister. One home for them beats six copies.
// ponytail: no JSX here, so the shell's English scan does not apply — keep it
// that way; label *tables* live in the route that renders them.
//
// `ApiError` comes from ../api-error, never ../api.server: this module is not a
// route, so the client bundle takes it whole and a `.server` import here is a
// build error ("Server-only module referenced by client").

/** Permissions the ORBIT screens gate on. Mirrors apps/api/src/resources.ts. */
export const ORBIT = {
  conversations: "orbit:conversations:read",
  assign: "orbit:conversations:assign",
  messages: "orbit:messages:read",
  renewals: "orbit:renewals:read",
  renewalsWrite: "orbit:renewals:update",
  journeys: "orbit:journeys:read",
  journeysWrite: "orbit:journeys:write",
  runs: "orbit:journeys:read",
  partners: "orbit:partners:read",
  handovers: "orbit:handover:read",
  handoverWrite: "orbit:handover:write",
  send: "orbit:messages:send",
  presence: "orbit:presence:read",
  qa: "orbit:qa:read",
  qaScore: "orbit:qa:score",
  reportRun: "analytics:reports:run",
  exportCreate: "analytics:exports:create"
} as const;

/** What the generic list endpoints answer (docs/04 §3). */
export interface Page<T> {
  data: T[];
  cursor?: string | null;
  total?: number;
}

export type Labels = Record<string, Record<string, string>>;
export type Label = (key: string, vars?: Record<string, string>) => string;

/**
 * The one resolver, taken uncurried for the ORBIT screens that were written
 * before there was a shared one (docs/ui.md §7 P3-14).
 */
export function labelsFrom(table: Labels, locale: string, pack?: string): Label {
  return kitLabelsFrom(table)(locale, pack);
}

/** A withheld read is an empty panel, not a blank screen. */
export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return fallback;
    throw error;
  }
}

/** An action's refusal, or a rethrow if it was a real fault. */
export function refusal(error: unknown): Problem {
  if (error instanceof ApiError) return error.problem;
  throw error;
}

export const DAY_MS = 86_400_000;

/** Whole days from `now` until `at`; negative once `at` has passed. */
export function daysUntil(at: number | null | undefined, now: number): number | null {
  if (!at) return null;
  return Math.ceil((at - now) / DAY_MS);
}
