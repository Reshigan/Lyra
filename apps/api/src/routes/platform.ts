import { Hono } from "hono";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { id, schema } from "@lyra/db";
import { actorRef, audit, can, conflict, forbidden, gate, notFound, require_, type Ctx } from "@lyra/core";
import { body, created } from "../http.js";
import { activeTenants } from "../auth.js";
import type { App } from "../env.js";

// ADR-0028: the one global (non-tenant-scoped) table in the schema — a flag
// gates a capability for tenants that haven't signed up yet. No scoped()/
// assertTenant() here on purpose; there is no tenant to scope against.

export const platformRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

platformRoutes.get("/flags", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:flags:read");
  const flags = await ctx.db.select().from(schema.featureFlags);
  return c.json({ flags });
});

const CreateFlagBody = z
  .object({
    key: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    targetTenantIds: z.array(z.string().min(1)).max(500).optional()
  })
  .strict();

platformRoutes.post("/flags", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:flags:write");
  const input = await body(c, CreateFlagBody);
  const row = {
    id: id("flg", ctx.now),
    key: input.key,
    description: input.description,
    enabled: false,
    rolloutPercent: input.rolloutPercent ?? 0,
    targetTenantIdsJson: input.targetTenantIds ? JSON.stringify(input.targetTenantIds) : null,
    updatedBy: actorRef(ctx),
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.featureFlags).values(row);
  await audit(ctx, { action: "platform.flag.created", subjectRef: row.id, after: row });
  return created(c, row);
});

const PatchFlagBody = z
  .object({
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    targetTenantIds: z.array(z.string().min(1)).max(500).optional()
  })
  .strict();

platformRoutes.patch("/flags/:id", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:flags:write");
  const input = await body(c, PatchFlagBody);
  const flagId = c.req.param("id");
  const rows = await ctx.db.select().from(schema.featureFlags).where(eq(schema.featureFlags.id, flagId)).limit(1);
  const row = rows[0];
  if (!row) throw notFound("flag");

  // Only a change to `enabled` is the toggle ADR-0028 gates — a capability
  // going live for every tenant at once, never a rollout-percent nudge.
  if (input.enabled !== undefined && input.enabled !== row.enabled) {
    await gate(ctx, { policyKey: "core.flag_toggle", subjectRef: flagId });
  }

  const patch = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.rolloutPercent !== undefined ? { rolloutPercent: input.rolloutPercent } : {}),
    ...(input.targetTenantIds !== undefined ? { targetTenantIdsJson: JSON.stringify(input.targetTenantIds) } : {}),
    updatedBy: actorRef(ctx),
    updatedAt: ctx.now
  };
  await ctx.db.update(schema.featureFlags).set(patch).where(eq(schema.featureFlags.id, flagId));
  const updated = { ...row, ...patch };
  await audit(ctx, { action: "platform.flag.updated", subjectRef: flagId, before: row, after: updated });
  return c.json(updated);
});

/**
 * ADR-0029: a fresh per-tenant identity for the cross-tenant read loop below.
 * `can()` checks `subject.tenantId === actor.tenantId` first, so the actor's
 * `tenantId` has to move with the loop, not just `ctx.tenantId` — otherwise
 * every entity-scoped permission check would compare against the platform
 * user's home tenant instead of the tenant being read. This is deliberately
 * lighter than `ctxFor()`: these routes never touch `ctx.policy`/
 * `ctx.entitlements`, so there is no need to re-fetch tenant config per tenant
 * (which would also throw on a suspended tenant instead of just skipping it).
 */
function scopedToTenant(ctx: Ctx, tenantId: string): Ctx {
  return { ...ctx, tenantId, actor: { ...ctx.actor, tenantId } };
}

platformRoutes.get("/ops/overview", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:diagnostics:read");
  const tenants: { tenantId: string; outboxPending: number; dlqDepth: number; pendingApprovals: number }[] = [];
  let lastSnapshotAt: number | null = null;

  for (const tenantId of await activeTenants(c.env)) {
    const tctx = scopedToTenant(ctx, tenantId);
    if (!can(tctx.actor, "admin:diagnostics:read")) continue;

    const outbox = await tctx.db
      .select({ id: schema.eventOutbox.id })
      .from(schema.eventOutbox)
      .where(and(eq(schema.eventOutbox.tenantId, tenantId), isNull(schema.eventOutbox.publishedAt)));
    const dlq = await tctx.db
      .select({ id: schema.eventDlq.id })
      .from(schema.eventDlq)
      .where(and(eq(schema.eventDlq.tenantId, tenantId), isNull(schema.eventDlq.replayedAt)));
    const approvalsPending = await tctx.db
      .select({ id: schema.approvals.id })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, tenantId), eq(schema.approvals.decision, "pending")));
    const latestSnapshot = await tctx.db
      .select({ ts: schema.northSnapshots.ts })
      .from(schema.northSnapshots)
      .where(eq(schema.northSnapshots.tenantId, tenantId))
      .orderBy(desc(schema.northSnapshots.ts))
      .limit(1);

    tenants.push({
      tenantId,
      outboxPending: outbox.length,
      dlqDepth: dlq.length,
      pendingApprovals: approvalsPending.length
    });
    const ts = latestSnapshot[0]?.ts;
    if (ts !== undefined && (lastSnapshotAt === null || ts > lastSnapshotAt)) lastSnapshotAt = ts;
  }

  return c.json({ tenants, lastSnapshotAt });
});

/** module -> table read for the SLO's success/total counts over its window (ADR-0029). */
async function sloCounts(ctx: Ctx, module: string, windowStart: number): Promise<{ success: number; total: number }> {
  if (module === "events") {
    const rows = await ctx.db
      .select({ published: schema.eventOutbox.publishedAt })
      .from(schema.eventOutbox)
      .where(and(eq(schema.eventOutbox.tenantId, ctx.tenantId), gte(schema.eventOutbox.createdAt, windowStart)));
    return { success: rows.filter((r) => r.published !== null).length, total: rows.length };
  }
  if (module === "webhooks") {
    const rows = await ctx.db
      .select({ status: schema.webhookDeliveries.status })
      .from(schema.webhookDeliveries)
      .where(
        and(eq(schema.webhookDeliveries.tenantId, ctx.tenantId), gte(schema.webhookDeliveries.createdAt, windowStart))
      );
    return { success: rows.filter((r) => r.status === "delivered").length, total: rows.length };
  }
  const rows = await ctx.db
    .select({ outcome: schema.aiAuditLog.outcome })
    .from(schema.aiAuditLog)
    .where(and(eq(schema.aiAuditLog.tenantId, ctx.tenantId), gte(schema.aiAuditLog.ts, windowStart)));
  return { success: rows.filter((r) => r.outcome === "ok").length, total: rows.length };
}

platformRoutes.get("/slo", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:diagnostics:read");
  const definitions = await ctx.db.select().from(schema.sloDefinitions);
  const tenantIds = await activeTenants(c.env);

  const slos = [];
  for (const def of definitions) {
    const windowStart = ctx.now - def.windowDays * 24 * 60 * 60 * 1000;
    let success = 0;
    let total = 0;
    for (const tenantId of tenantIds) {
      const tctx = scopedToTenant(ctx, tenantId);
      if (!can(tctx.actor, "admin:diagnostics:read")) continue;
      const counts = await sloCounts(tctx, def.module, windowStart);
      success += counts.success;
      total += counts.total;
    }
    const actualPercent = total === 0 ? 100 : Math.round((success / total) * 10000) / 100;
    slos.push({ ...def, actualPercent, burnPercent: Math.max(0, def.targetPercent - actualPercent) });
  }
  return c.json({ slos });
});

// The operator's own live sessions. Without this an "end impersonation"
// control cannot find the session id again after a reload, and the swap only
// clears when auth.ts starts 401ing on expiry.
platformRoutes.get("/impersonation", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:impersonate:use");
  const sessions = await ctx.db
    .select()
    .from(schema.impersonationSessions)
    .where(
      and(
        eq(schema.impersonationSessions.platformUserId, ctx.actor.id),
        isNull(schema.impersonationSessions.endedAt)
      )
    )
    .orderBy(desc(schema.impersonationSessions.startedAt));
  return c.json({ sessions });
});

const StartImpersonationBody = z
  .object({
    targetUserId: z.string().min(1),
    reason: z.string().min(1).max(500)
  })
  .strict();

const IMPERSONATION_DURATION_MS = 30 * 60 * 1000;

platformRoutes.post("/impersonation/start", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:impersonate:use");
  const input = await body(c, StartImpersonationBody);

  // The target is looked up cross-tenant by primary key on purpose: the
  // permission gating this whole route is itself the cross-tenant authority
  // (ADR-0027), and there is no tenant to scope the lookup against yet.
  const targets = await ctx.db.select().from(schema.users).where(eq(schema.users.id, input.targetUserId)).limit(1);
  const target = targets[0];
  if (!target) throw notFound("user");

  const approval = await gate(ctx, {
    policyKey: "core.impersonate",
    subjectRef: input.targetUserId,
    context: { reason: input.reason }
  });
  // `gate` only returns non-null once a second platform actor has approved —
  // `core.impersonate`'s `neverAutoApprove` guarantees it is never null here.
  if (!approval) throw notFound("approval");

  const row = {
    id: id("ims", ctx.now),
    tenantId: target.tenantId,
    platformUserId: ctx.actor.id,
    targetUserId: target.id,
    approvalId: approval.id,
    reason: input.reason,
    startedAt: ctx.now,
    expiresAt: ctx.now + IMPERSONATION_DURATION_MS,
    endedAt: null
  };
  await ctx.db.insert(schema.impersonationSessions).values(row);
  await audit(ctx, { action: "platform.impersonation.started", subjectRef: target.id, after: row });
  return created(c, row);
});

platformRoutes.post("/impersonation/:id/end", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:impersonate:use");
  const sessionId = c.req.param("id");
  const rows = await ctx.db
    .select()
    .from(schema.impersonationSessions)
    .where(eq(schema.impersonationSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("impersonation session");
  if (row.platformUserId !== ctx.actor.id) throw forbidden("not your impersonation session");
  if (row.endedAt !== null) throw conflict("already ended");

  const updated = { ...row, endedAt: ctx.now };
  await ctx.db
    .update(schema.impersonationSessions)
    .set({ endedAt: ctx.now })
    .where(eq(schema.impersonationSessions.id, sessionId));
  await audit(ctx, { action: "platform.impersonation.ended", subjectRef: row.targetUserId, before: row, after: updated });
  return c.json(updated);
});

platformRoutes.get("/incidents", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:diagnostics:read");
  const rows = [];
  for (const tenantId of await activeTenants(c.env)) {
    const tctx = scopedToTenant(ctx, tenantId);
    if (!can(tctx.actor, "admin:diagnostics:read")) continue;
    const found = await tctx.db
      .select()
      .from(schema.incidents)
      .where(and(eq(schema.incidents.tenantId, tenantId), eq(schema.incidents.kind, "outage")));
    rows.push(...found);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ incidents: rows });
});

platformRoutes.get("/deployments", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "admin:diagnostics:read");
  const deployments = await ctx.db.select().from(schema.deployments).orderBy(desc(schema.deployments.deployedAt));
  return c.json({ deployments });
});
