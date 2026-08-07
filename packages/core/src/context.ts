import { eq, and, isNull, type SQL } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Atomic, EntitlementsJson, PolicyJson } from "@lyra/db";
import { notFound } from "./errors.js";
import type { Actor } from "./rbac.js";

// ponytail: one structural DB type instead of a driver union — the same code runs
// on D1 (cloud) and libsql (on-prem), and neither needs the relational query API.
// `Atomic` is the one driver capability the money path needs and both homes have
// (docs/19 §5); it is on the base type because a handler must never receive a
// connection it cannot write a transaction through.
export type CoreDb = BaseSQLiteDatabase<"async", any, Record<string, never>> & Atomic;

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

/** Tables that carry tenant_id (every table, per docs/03) — plus core_tenants. */
interface TenantTable {
  tenantId?: SQLiteColumn;
  id?: SQLiteColumn;
  deletedAt?: SQLiteColumn;
}

/**
 * The column that scopes a row to a tenant. `core_tenants` carries no tenant_id
 * because the row *is* the tenant, so its own id scopes it. A table with
 * neither would produce a WHERE with no tenant filter at all — that is a leak,
 * so it throws instead.
 */
function tenantCol(table: TenantTable): SQLiteColumn {
  const col = table.tenantId ?? table.id;
  if (!col) throw new Error("table has no tenant column and cannot be scoped");
  return col;
}

/**
 * The only way to build a WHERE for a tenant-scoped table. Adds the soft-delete
 * filter when the table has one, so `deleted_at` rows never leak by omission.
 */
export function scoped(ctx: Ctx, table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
  const parts: (SQL | undefined)[] = [eq(tenantCol(table), ctx.tenantId)];
  if (table.deletedAt) parts.push(isNull(table.deletedAt));
  parts.push(...extra);
  return and(...parts) as SQL;
}

/** Include soft-deleted rows (restore flows, audit exports, DSAR). */
export function scopedWithDeleted(ctx: Ctx, table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
  return and(eq(tenantCol(table), ctx.tenantId), ...extra) as SQL;
}

/**
 * Runtime backstop for rows that arrived from anywhere but `scoped()`.
 * Cross-tenant rows read as missing — never as forbidden, which would confirm they exist.
 */
export function assertTenant<T extends { tenantId: string } | { id: string }>(
  ctx: Ctx,
  row: T | undefined | null,
  resource = "resource"
): T {
  // Same rule as scoped(): a core_tenants row is identified by its own id.
  const owner = (row as { tenantId?: string; id?: string } | null)?.tenantId ?? (row as { id?: string } | null)?.id;
  if (!row || owner !== ctx.tenantId) throw notFound(resource);
  return row;
}

export function actorRef(ctx: Ctx): string {
  return `${ctx.actor.kind}:${ctx.actor.id}`;
}
