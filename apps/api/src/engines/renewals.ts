import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

// docs/05 J-C3. A renewal is raised by a sweep, not by a person — `orbit:renewals`
// carries read and update and no create, so without this tick the retention desk
// has an empty queue for ever and the one-tap renewal journey never starts.

/** A policy enters the renewal queue this far ahead of its end date. */
const WINDOW_DAYS = 45;

/**
 * Insert a `scheduled` renewal for every active policy expiring inside the
 * window that does not have one yet. Idempotent: re-running inside the same
 * window is a no-op, so a missed cron tick costs nothing.
 */
export async function sweepRenewals(ctx: Ctx): Promise<number> {
  const due = await ctx.db
    .select({
      id: schema.axisPolicies.id,
      customerId: schema.axisPolicies.customerId,
      endAt: schema.axisPolicies.endAt
    })
    .from(schema.axisPolicies)
    .where(
      and(
        eq(schema.axisPolicies.tenantId, ctx.tenantId),
        eq(schema.axisPolicies.status, "active"),
        gte(schema.axisPolicies.endAt, ctx.now),
        lte(schema.axisPolicies.endAt, ctx.now + WINDOW_DAYS * 86_400_000)
      )
    );
  if (!due.length) return 0;

  const existing = new Set(
    (
      await ctx.db
        .select({ policyRef: schema.orbitRenewals.policyRef })
        .from(schema.orbitRenewals)
        .where(
          and(
            eq(schema.orbitRenewals.tenantId, ctx.tenantId),
            inArray(
              schema.orbitRenewals.policyRef,
              due.map((p) => p.id)
            )
          )
        )
    ).map((r) => r.policyRef)
  );

  const rows = due
    .filter((p) => !existing.has(p.id))
    .map((p) => ({
      id: newId("rnw", ctx.now),
      tenantId: ctx.tenantId,
      policyRef: p.id,
      customerId: p.customerId,
      expiryAt: p.endAt,
      strategy: "human",
      state: "scheduled",
      createdAt: ctx.now,
      updatedAt: ctx.now
    }));
  if (!rows.length) return 0;

  await ctx.db.insert(schema.orbitRenewals).values(rows as never);
  return rows.length;
}
