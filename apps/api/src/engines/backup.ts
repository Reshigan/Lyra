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

/**
 * Replays one day's dump back into the database: the tenant's slice of every
 * table present in the dump is cleared and reinserted, so the slice ends up
 * exactly as backed up (runbooks/R-03-restore-drill.md path B). Tables absent
 * from the dump are left untouched — an old dump knows nothing about a table
 * added later, and wiping what it never saw is loss, not restore. No table in
 * the schema declares a foreign key, so insert order is free.
 */
export async function restoreTenant(
  ctx: Ctx,
  bucket: R2Bucket | undefined,
  day: string
): Promise<{ tables: number; rows: number }> {
  const key = `backups/${ctx.tenantId}/${day}.json`;
  const object = bucket && (await bucket.get(key));
  if (!object) throw new Error(`no backup at ${key}`);
  const dump = (await object.json()) as Record<string, Record<string, unknown>[]>;
  let tables = 0;
  let rows = 0;
  for (const table of TABLES) {
    if (!("tenantId" in table)) continue;
    const dumped = dump[getTableName(table)];
    if (!dumped) continue;
    // Trust boundary: the dump is data, not authority — a row claiming another
    // tenant (tampered or wrong file) never crosses into this tenant's slice.
    const own = dumped.filter((row) => row.tenantId === ctx.tenantId);
    await ctx.db.delete(table).where(scopedWithDeleted(ctx, table as never));
    // D1 caps bound parameters per statement, so chunk by row width.
    const width = Math.max(1, Object.keys(own[0] ?? {}).length);
    const chunk = Math.max(1, Math.floor(90 / width));
    for (let i = 0; i < own.length; i += chunk) {
      await ctx.db.insert(table).values(own.slice(i, i + chunk) as never);
    }
    tables += 1;
    rows += own.length;
  }
  return { tables, rows };
}
