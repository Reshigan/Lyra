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
