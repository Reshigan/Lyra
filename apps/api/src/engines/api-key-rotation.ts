import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

// docs/10 §6: "Rotation: API keys 90d nudge." One notification per key, once it
// crosses 90 days old and is still live — dedupe against any prior nudge for
// that key so a live key that never gets rotated doesn't spam its owner every
// tick, forever.

const ROTATE_AFTER_MS = 90 * 86_400_000;
const KIND = "warning";
const TITLE_KEY = "core.apiKey.rotationDue";

/** `user:u_1` -> `u_1`; anything else (service/system) has no inbox to nudge. */
function ownerOf(createdBy: string): string[] {
  const [kind, userId] = createdBy.split(":");
  return kind === "user" && userId ? [userId] : [];
}

export async function nudgeApiKeyRotation(ctx: Ctx): Promise<number> {
  const stale = await ctx.db
    .select({ id: schema.apiKeys.id, name: schema.apiKeys.name, createdBy: schema.apiKeys.createdBy, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.tenantId, ctx.tenantId),
        isNull(schema.apiKeys.revokedAt),
        lte(schema.apiKeys.createdAt, ctx.now - ROTATE_AFTER_MS)
      )
    );
  if (!stale.length) return 0;

  const alreadyNudged = new Set(
    (
      await ctx.db
        .select({ subjectRef: schema.notifications.subjectRef })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.tenantId, ctx.tenantId),
            eq(schema.notifications.kind, KIND),
            eq(schema.notifications.titleKey, TITLE_KEY),
            inArray(
              schema.notifications.subjectRef,
              stale.map((k) => k.id)
            )
          )
        )
    ).map((n) => n.subjectRef)
  );

  const rows = stale
    .filter((k) => !alreadyNudged.has(k.id))
    .flatMap((k) =>
      ownerOf(k.createdBy).map((userId) => ({
        id: newId("ntf", ctx.now),
        tenantId: ctx.tenantId,
        userId,
        kind: KIND,
        titleKey: TITLE_KEY,
        paramsJson: JSON.stringify({ name: k.name, ageDays: Math.floor((ctx.now - k.createdAt) / 86_400_000) }),
        subjectRef: k.id,
        readAt: null,
        createdAt: ctx.now
      }))
    );
  if (!rows.length) return 0;
  await ctx.db.insert(schema.notifications).values(rows);
  return rows.length;
}
