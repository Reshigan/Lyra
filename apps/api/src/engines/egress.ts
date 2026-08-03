import { sql } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

/**
 * docs/25 §6 cost guards: every byte served out of R2 lands on the tenant's
 * daily egress counter, so the cost explorer can price egress instead of
 * declaring it unmetered. Call at the seam that streams an R2 body to the
 * client, with the stored object size — one row per tenant per day.
 */
export async function meterEgress(ctx: Ctx, bytes: number | null | undefined): Promise<void> {
  if (!bytes || bytes <= 0) return;
  const day = new Date(ctx.now).toISOString().slice(0, 10);
  await ctx.db
    .insert(schema.egressDays)
    .values({ id: newId("egr", ctx.now), tenantId: ctx.tenantId, day, bytes, updatedAt: ctx.now })
    .onConflictDoUpdate({
      target: [schema.egressDays.tenantId, schema.egressDays.day],
      set: { bytes: sql`${schema.egressDays.bytes} + ${bytes}`, updatedAt: ctx.now }
    });
}
