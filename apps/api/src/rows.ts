import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { notFound, scoped, type Ctx } from "@lyra/core";

// Fetch-one by id, tenant-scoped and soft-delete aware, because every
// hand-written route needs it and none of them should be writing the WHERE
// clause by hand.

type Row = SQLiteTable & { id: SQLiteColumn; tenantId: SQLiteColumn; deletedAt?: SQLiteColumn };

export async function one<T extends Row>(ctx: Ctx, table: T, rowId: string): Promise<T["$inferSelect"] | undefined> {
  const rows = await ctx.db
    .select()
    .from(table)
    .where(scoped(ctx, table, eq(table.id, rowId)))
    .limit(1);
  return rows[0] as T["$inferSelect"] | undefined;
}

/** Same, but a miss is a 404 rather than the caller's problem. */
export async function must<T extends Row>(
  ctx: Ctx,
  table: T,
  rowId: string,
  resource: string
): Promise<T["$inferSelect"]> {
  const row = await one(ctx, table, rowId);
  if (!row) throw notFound(resource);
  return row;
}
