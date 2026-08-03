import { and, eq, inArray, lte, or, isNull } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import {
  consume,
  hmacHex,
  markPublishFailed,
  markPublished,
  pendingOutbox,
  scoped,
  type Ctx,
  type Envelope
} from "@lyra/core";
import { onConsentUpdated } from "./engines/signal-suppression.js";

// The outbox drain. Events are written in the same request that changed the row,
// so delivery can fail all it likes without ever losing the fact that something
// happened (docs/04 §7).

/** Exponential, capped. A subscriber that is down for an hour is not our problem. */
const BACKOFF_MS = [0, 30_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

export interface DrainResult {
  published: number;
  delivered: number;
  failed: number;
  queued: number;
}

/** Minimal surface of the `EVENTS` queue binding this file calls. */
export interface EventQueue {
  send(body: Envelope): Promise<unknown>;
}

/**
 * docs/10 §2: the Queue is the fan-out hop, the D1 outbox is the durability hop.
 * With `queue` bound, webhook delivery moves off the cron tick onto queue
 * consumers (`deliverQueued` below, called from index.ts's `queue()` handler) so
 * a slow subscriber endpoint no longer blocks the next tenant's drain. Without
 * one (on-prem, tests) delivery stays inline — same `deliverQueued` call, just
 * synchronous.
 */
export async function drainOutbox(ctx: Ctx, queue?: EventQueue, limit = 100): Promise<DrainResult> {
  const events = await pendingOutbox(ctx.db, limit, ctx.now);
  if (!events.length) return { published: 0, delivered: 0, failed: 0, queued: 0 };

  let delivered = 0;
  let failed = 0;
  let queued = 0;
  const done: string[] = [];

  for (const event of events) {
    // A single bad event must not abort the drain: mark it failed (so its
    // attempts rise toward pendingOutbox's dead-letter cap) and keep going.
    try {
      // Internal consumers run in the same drain tick as external delivery, so a
      // consent withdrawal reaches SIGNAL's suppression audience in one drain
      // pass rather than waiting on a dedicated cron (docs/25 M4 SIGNAL row).
      // ponytail: one `if`, not a registry — add a second internal consumer here
      // when a second one exists, not before.
      if (event.type === "core.consent.updated") {
        await consume(ctx.db, event, "signal.suppression", (e) => onConsentUpdated(ctx, e), ctx.now);
      }

      if (queue) {
        await queue.send(event);
        queued++;
      } else {
        const outcome = await deliverQueued(ctx, event);
        delivered += outcome.delivered;
        failed += outcome.failed;
      }
      done.push(event.id);
    } catch (err) {
      failed++;
      await markPublishFailed(ctx.db, event.id, String(err));
    }
  }

  await markPublished(ctx.db, done, ctx.now);
  // Retries run every tick regardless of the queue: they replay rows already
  // written to webhook_deliveries by a prior `deliver()` call, queued or not.
  await retryFailed(ctx);
  return { published: done.length, delivered, failed, queued };
}

/** Webhook fan-out for one event: looked up here so both the inline path and the
 * queue consumer (index.ts `queue()`) share the same delivery logic. */
export async function deliverQueued(ctx: Ctx, event: Envelope): Promise<{ delivered: number; failed: number }> {
  const hooks = await ctx.db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.tenantId, ctx.tenantId), eq(schema.webhooks.status, "active")));

  let delivered = 0;
  let failed = 0;
  for (const hook of hooks.filter((h) => subscribes(h.eventTypesJson, event.type))) {
    const outcome = await deliver(ctx, hook, event, 0);
    if (outcome.ok) delivered++;
    else failed++;
  }
  return { delivered, failed };
}

/** `["*"]` or `["axis.case.*"]` or an exact type. */
function subscribes(raw: string, type: string): boolean {
  let patterns: string[];
  try {
    patterns = JSON.parse(raw) as string[];
  } catch {
    return false;
  }
  return patterns.some((p) =>
    p === "*" || p === type || (p.endsWith("*") && type.startsWith(p.slice(0, -1)))
  );
}

interface Hook {
  id: string;
  url: string;
  secret: string;
}

async function deliver(
  ctx: Ctx,
  hook: Hook,
  event: Envelope,
  attempt: number
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = JSON.stringify(event);
  // Signed with the shared secret so a subscriber can prove the call is ours.
  const signature = await hmacHex(hook.secret, `${ctx.now}.${payload}`);
  let status: number | undefined;
  let error: string | undefined;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lyra-event": event.type,
        "x-lyra-event-id": event.id,
        "x-lyra-timestamp": String(ctx.now),
        "x-lyra-signature": `v1=${signature}`
      },
      body: payload,
      signal: AbortSignal.timeout(10_000)
    });
    status = res.status;
    if (!res.ok) error = `http ${res.status}`;
  } catch (e) {
    error = String(e).slice(0, 500);
  }

  const ok = !error;
  const next = attempt + 1;
  await ctx.db.insert(schema.webhookDeliveries).values({
    id: newId("whd", ctx.now),
    tenantId: ctx.tenantId,
    webhookId: hook.id,
    eventId: event.id,
    status: ok ? "delivered" : next >= MAX_ATTEMPTS ? "dead" : "failed",
    responseCode: status ?? null,
    attempts: next,
    nextAttemptAt: ok || next >= MAX_ATTEMPTS ? null : ctx.now + (BACKOFF_MS[next] ?? 0),
    error: error ?? null,
    createdAt: ctx.now
  });
  if (!ok) await markPublishFailed(ctx.db, event.id, error ?? "unknown");
  return { ok, ...(status !== undefined ? { status } : {}), ...(error !== undefined ? { error } : {}) };
}

/** Second pass: deliveries whose backoff has elapsed. */
async function retryFailed(ctx: Ctx, limit = 50): Promise<void> {
  const due = await ctx.db
    .select()
    .from(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.tenantId, ctx.tenantId),
        eq(schema.webhookDeliveries.status, "failed"),
        or(
          isNull(schema.webhookDeliveries.nextAttemptAt),
          lte(schema.webhookDeliveries.nextAttemptAt, ctx.now)
        )
      )
    )
    .limit(limit);
  if (!due.length) return;

  const hookIds = [...new Set(due.map((d) => d.webhookId))];
  const hooks = await ctx.db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.tenantId, ctx.tenantId), inArray(schema.webhooks.id, hookIds)));

  const eventIds = [...new Set(due.map((d) => d.eventId))];
  const rows = await ctx.db
    .select()
    .from(schema.eventOutbox)
    .where(
      and(eq(schema.eventOutbox.tenantId, ctx.tenantId), inArray(schema.eventOutbox.id, eventIds))
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const d of due) {
    const hook = hooks.find((h) => h.id === d.webhookId);
    const row = byId.get(d.eventId);
    if (!hook || !row) continue;
    let event: Envelope;
    try {
      event = JSON.parse(row.envelopeJson) as Envelope;
    } catch {
      continue;
    }
    // Supersede rather than update: the delivery table is the attempt history.
    await ctx.db
      .update(schema.webhookDeliveries)
      .set({ status: "superseded" })
      .where(scoped(ctx, schema.webhookDeliveries as never, eq(schema.webhookDeliveries.id, d.id)));
    await deliver(ctx, hook, event, d.attempts);
  }
}
