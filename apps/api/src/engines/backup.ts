import { is, getTableName } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { schema } from "@lyra/db";
import { scopedWithDeleted, type Ctx } from "@lyra/core";

// docs/10 §6: "Backups: D1 time-travel + nightly export to R2 (30d)". D1 Time
// Travel is a Cloudflare platform default (30d PITR, no config) and already
// covers restoring the live database — this job is the portable copy that
// compliance/DR needs off the live D1 instance. One JSON blob per tenant per
// day, every table that carries tenant_id, soft-deleted rows included (a
// backup that quietly drops deleted rows is not a backup). R2 lifecycle rule
// on EXPORTS enforces the 30d retention (see infra/cloudflare); this function
// only writes.
const TABLES = Object.values(schema).filter((t) => is(t, SQLiteTable)) as SQLiteTable[];

export async function backupTenant(ctx: Ctx, bucket: R2Bucket | undefined): Promise<void> {
  if (!bucket) return;
  const dump: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    if (!("tenantId" in table)) continue; // core_tenants itself: the row IS the tenant
    dump[getTableName(table)] = await ctx.db.select().from(table).where(scopedWithDeleted(ctx, table as never));
  }
  const day = new Date(ctx.now).toISOString().slice(0, 10);
  await bucket.put(`backups/${ctx.tenantId}/${day}.json`, JSON.stringify(dump), {
    httpMetadata: { contentType: "application/json" }
  });
}
