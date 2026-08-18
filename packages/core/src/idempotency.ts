import { and, eq, lt } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { conflict } from "./errors.js";
import { canonicalJson, sha256Hex } from "./crypto.js";
import type { Ctx, CoreDb } from "./context.js";

// docs/04 §1: every POST accepts Idempotency-Key, honoured for 24h.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The (tenant, key, route) triple that IS the slot, in one place. */
const slot = (ctx: Ctx, key: string, route: string) =>
  and(
    eq(schema.idempotencyKeys.tenantId, ctx.tenantId),
    eq(schema.idempotencyKeys.key, key),
    eq(schema.idempotencyKeys.route, route)
  );

/**
 * Run `fn` at most once per (tenant, key, route). A replay with the same body
 * returns the stored response; a replay with a different body is a 409 — the
 * key has been reused for something else.
 */
export async function withIdempotency<T>(
  ctx: Ctx,
  key: string | undefined,
  route: string,
  request: unknown,
  fn: () => Promise<T>
): Promise<T> {
  if (!key) return fn();

  const requestHash = await sha256Hex(canonicalJson(request));
  const existing = await ctx.db.select().from(schema.idempotencyKeys).where(slot(ctx, key, route)).limit(1);

  const row = existing[0];
  if (row) {
    if (row.expiresAt > ctx.now) {
      if (row.requestHash !== requestHash) throw conflict("idempotency key reused with a different body");
      if (row.status === "done" && row.responseJson) return JSON.parse(row.responseJson) as T;
      throw conflict("an identical request is still in flight");
    }
    // Expired: take the slot over.
    await ctx.db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, row.id));
  }

  const id = newId("idm", ctx.now);
  await ctx.db.insert(schema.idempotencyKeys).values({
    id,
    tenantId: ctx.tenantId,
    key,
    route,
    requestHash,
    responseJson: null,
    status: "in_flight",
    expiresAt: ctx.now + IDEMPOTENCY_TTL_MS,
    createdAt: ctx.now
  });

  try {
    const result = await fn();
    await ctx.db
      .update(schema.idempotencyKeys)
      .set({ status: "done", responseJson: JSON.stringify(result ?? null) })
      .where(eq(schema.idempotencyKeys.id, id));
    return result;
  } catch (err) {
    // A failed attempt must not block a retry.
    await ctx.db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, id));
    throw err;
  }
}

/**
 * Forget a completed attempt, so the same key may run again.
 *
 * For the narrow case where a handler succeeded but did nothing: replaying "I
 * did nothing" for the next 24h is wrong when the caller's second attempt would
 * do something (the UBI reprice, `apps/api/src/routes/axis.ts`, whose fallback
 * key is derived from a version a no-op does not change). Call it only when the
 * run left no state behind — releasing a key whose attempt DID write is how a
 * double charge happens.
 */
export async function releaseIdempotency(ctx: Ctx, key: string | undefined, route: string): Promise<void> {
  if (!key) return;
  await ctx.db.delete(schema.idempotencyKeys).where(slot(ctx, key, route));
}

export async function pruneIdempotency(db: CoreDb, now: number): Promise<void> {
  await db.delete(schema.idempotencyKeys).where(lt(schema.idempotencyKeys.expiresAt, now));
}
