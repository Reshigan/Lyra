import type { Context } from "hono";
import { z } from "zod";
import { AppError, badRequest, toProblem, type Problem } from "@lyra/core";
import type { App } from "./env.js";

// docs/04 §1. Everything an endpoint needs that is not business logic: shapes,
// problem+json rendering, cursor pagination and the list-query parser. Kept in
// one file so the routers stay readable as routers.

export const PROBLEM_MIME = "application/problem+json";

export function problem(c: Context<App>, err: unknown): Response {
  const p: Problem = toProblem(err, c.req.path);
  const status = (p.status || 500) as 400;
  return c.json(p, status, { "content-type": PROBLEM_MIME });
}

/** Parse a body against a schema, or throw a 400 carrying field-level errors. */
export async function body<T extends z.ZodTypeAny>(c: Context<App>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("request body is not valid JSON");
  }
  return parse(schema, raw);
}

export function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const out = schema.safeParse(raw);
  if (out.success) return out.data;
  const errors: Record<string, string> = {};
  for (const issue of out.error.issues) errors[issue.path.join(".") || "_"] = issue.message;
  throw badRequest("validation failed", errors);
}

/**
 * An instant a `Date` can actually hold (ECMA-262: ±8.64e15 ms from the epoch).
 * `z.number().int()` alone is a *safe*-integer check, so it lets through the band
 * (8.64e15, 9.007e15] — and every renderer downstream (`new Date(ms).toISOString()`,
 * the fraud prompt, the claim UI) throws on those. It threw inside a blanket
 * `catch`, so a claimant filing with a big number silently turned their own fraud
 * scoring off. Rejected at the trust boundary; `promptInstant` is the second layer.
 *
 * Lives here rather than beside one endpoint because every write surface needs
 * the same bound: the AXIS FNOL bodies, and the generated CRUD shape (crud.ts).
 */
export const InstantMs = z.number().int().min(-8.64e15).max(8.64e15);

/**
 * Whether a field name means "epoch milliseconds", by convention — the schema
 * has no marker for it, so the name is all there is to go on.
 *
 * ponytail: four name rules, re-derived by censusing every integer/real column
 * in packages/db/src/schema — 625 numeric columns, of which the rules match
 * 366 and every match is an instant (no false positives).
 * Ceiling: seven instant columns are named outside the rules and are NOT
 * recognised — `axis.telemetryPoints.at`, `axis.quotes.validUntil`,
 * `dist.quoteResponses.validUntil`, `signal.budgetMoves.reversibleUntil`,
 * `scout.clusters.firstSeen`, `scout.clusters.lastSeen`,
 * `signal.aeoPages.freshness`. None of those seven tables is registered in
 * resources.ts, so none has a generic-CRUD write surface; the two that take
 * caller input at all (`at`, `validUntil`) are bounded by hand at their own
 * endpoints (routes/axis.ts). Register any of those tables and this list is
 * the checklist. Upgrade path is a marker on the column itself, which Drizzle
 * has no room for — so a declared set on Resource, a parallel list this exists
 * to avoid maintaining.
 *
 * `expiry` is a rule of its own rather than a suffix match: it is a whole key,
 * and it sits on three registered read-write resources (core/consents,
 * core/mandates, core/memories) whose values render through `<DateTime>`.
 */
export const isInstantKey = (key: string): boolean =>
  key.endsWith("At") || key.startsWith("effective") || key === "ts" || key === "expiry";

/* ------------------------------------------------------------- pagination */

export const MAX_PAGE = 200;

export interface Page<T> {
  data: T[];
  /** Opaque; pass back as `?cursor=`. Absent when the last page has been read. */
  cursor?: string;
  /** Only present when the caller asked for it — counting is not free at scale. */
  total?: number;
}

/**
 * Keyset cursor over `(sortValue, id)`. Offset pagination degrades on deep
 * pages, and a tenant's case list is exactly the thing an operator scrolls to
 * the bottom of.
 */
export function encodeCursor(sortValue: string | number | null, id: string): string {
  return btoa(JSON.stringify([sortValue, id])).replace(/=+$/, "");
}

export function decodeCursor(raw: string): { value: string | number | null; id: string } {
  try {
    const [value, id] = JSON.parse(atob(raw)) as [string | number | null, string];
    if (typeof id !== "string") throw new Error("bad cursor");
    return { value, id };
  } catch {
    throw badRequest("cursor is not valid");
  }
}

/* ------------------------------------------------------------ list params */

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  cursor: z.string().optional(),
  q: z.string().max(200).optional(),
  sort: z.string().max(64).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  /** Include soft-deleted rows. Requires the resource's delete permission. */
  deleted: z.coerce.boolean().default(false),
  count: z.coerce.boolean().default(false),
  /** ISO or epoch-ms window on the sort column. */
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional()
});
export type ListQuery = z.infer<typeof ListQuery>;

/** Everything not a reserved key is treated as an exact-match column filter. */
const RESERVED = new Set(Object.keys(ListQuery.shape));

export function listParams(c: Context<App>): { list: ListQuery; filters: Record<string, string> } {
  const raw = c.req.query();
  const list = parse(ListQuery, raw);
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (!RESERVED.has(k) && v !== "") filters[k] = v;
  return { list, filters };
}

/**
 * A single query param as a clamped integer. `Number("abc")` is NaN, and NaN
 * poisons every comparison and date arithmetic downstream — garbage input
 * falls back to the default instead.
 */
export function intParam(
  raw: string | undefined,
  def: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
): number {
  if (!raw) return def;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/* ------------------------------------------------------------------ misc */

export function requireHeader(c: Context<App>, name: string): string {
  const v = c.req.header(name);
  if (!v) throw badRequest(`${name} header is required`);
  return v;
}

/** 201 with a Location header — the shape every create endpoint returns. */
export function created<T extends { id: string }>(c: Context<App>, row: T): Response {
  return c.json(row, 201, { location: `${c.req.path}/${row.id}` });
}

export { AppError };
