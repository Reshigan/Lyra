import { eq, and, isNull, type SQL } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { EntitlementsJson, PolicyJson } from "@lyra/db";
import { notFound } from "./errors.js";
import type { Actor } from "./rbac.js";

// ponytail: one structural DB type instead of a driver union — the same code runs
// on D1 (cloud) and libsql (on-prem), and neither needs the relational query API.
export type CoreDb = BaseSQLiteDatabase<"async", any, Record<string, never>>;

/** Everything a request handler is allowed to know. Built once by the API gateway. */
export interface Ctx {
  db: CoreDb;
  tenantId: string;
  actor: Actor;
  requestId: string;
  /** Request-start epoch ms. One clock per request keeps rows in a request consistent. */
  now: number;
  locale: string;
  policy: PolicyJson;
  entitlements: EntitlementsJson;
  ip?: string;
  ua?: string;
}

/** Tables that carry tenant_id (every table, per docs/03). */
interface TenantTable {
  tenantId: SQLiteColumn;
  deletedAt?: SQLiteColumn;
}

/**
 * The only way to build a WHERE for a tenant-scoped table. Adds the soft-delete
 * filter when the table has one, so `deleted_at` rows never leak by omission.
 */
export function scoped(ctx: Ctx, table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
  const parts: (SQL | undefined)[] = [eq(table.tenantId, ctx.tenantId)];
  if (table.deletedAt) parts.push(isNull(table.deletedAt));
  parts.push(...extra);
  return and(...parts) as SQL;
}

/** Include soft-deleted rows (restore flows, audit exports, DSAR). */
export function scopedWithDeleted(ctx: Ctx, table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
  return and(eq(table.tenantId, ctx.tenantId), ...extra) as SQL;
}

/**
 * Runtime backstop for rows that arrived from anywhere but `scoped()`.
 * Cross-tenant rows read as missing — never as forbidden, which would confirm they exist.
 */
export function assertTenant<T extends { tenantId: string }>(
  ctx: Ctx,
  row: T | undefined | null,
  resource = "resource"
): T {
  if (!row || row.tenantId !== ctx.tenantId) throw notFound(resource);
  return row;
}

export function actorRef(ctx: Ctx): string {
  return `${ctx.actor.kind}:${ctx.actor.id}`;
}
