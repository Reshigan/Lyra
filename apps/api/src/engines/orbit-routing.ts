// gap-orbit-design.md §1B — routing/queueing engine. pickRoute and pickAssignee
// are pure: no DB, no clock, so every branch is a table-driven unit test.
// routeConversation and sweepRouting (below, once added) are the only I/O.

export interface RoutingConditions {
  readonly channel?: string;
  readonly intent?: string;
  readonly sentimentBelow?: number;
}

export interface RoutingRuleInput {
  readonly seq: number;
  readonly teamId: string;
  readonly enabled: boolean;
  readonly conditionsJson: string;
}

export interface RouteInput {
  readonly channel: string;
  readonly intent: string | null;
  readonly sentiment: number | null;
}

function matches(conditions: RoutingConditions, input: RouteInput): boolean {
  if (conditions.channel !== undefined && conditions.channel !== input.channel) return false;
  if (conditions.intent !== undefined && conditions.intent !== input.intent) return false;
  if (conditions.sentimentBelow !== undefined) {
    if (input.sentiment === null || input.sentiment >= conditions.sentimentBelow) return false;
  }
  return true;
}

/** First enabled rule (by `seq` ascending) whose conditions all match wins. Null = no rule matched; caller falls back to the tenant's default team. */
export function pickRoute(rules: readonly RoutingRuleInput[], input: RouteInput): string | null {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => a.seq - b.seq);
  for (const rule of sorted) {
    if (matches(JSON.parse(rule.conditionsJson) as RoutingConditions, input)) return rule.teamId;
  }
  return null;
}

export interface TeamMemberInput {
  readonly userId: string;
  readonly skillsJson: string;
  readonly maxConcurrent: number;
}

export interface PresenceInput {
  readonly status: "available" | "away" | "offline";
  readonly activeCount: number;
  readonly updatedAt: number;
}

/** Least-loaded, then longest-idle, then lowest userId (stable tiebreak). Null = nobody eligible. */
export function pickAssignee(
  members: readonly TeamMemberInput[],
  presence: ReadonlyMap<string, PresenceInput>,
  requireSkills: readonly string[]
): string | null {
  const eligible = members
    .map((m) => ({ member: m, presence: presence.get(m.userId) }))
    .filter((x): x is { member: TeamMemberInput; presence: PresenceInput } => {
      if (!x.presence || x.presence.status !== "available") return false;
      if (x.presence.activeCount >= x.member.maxConcurrent) return false;
      const skills = JSON.parse(x.member.skillsJson) as string[];
      return requireSkills.every((s) => skills.includes(s));
    });
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    if (a.presence.activeCount !== b.presence.activeCount) return a.presence.activeCount - b.presence.activeCount;
    if (a.presence.updatedAt !== b.presence.updatedAt) return a.presence.updatedAt - b.presence.updatedAt;
    return a.member.userId < b.member.userId ? -1 : 1;
  });
  return eligible[0]!.member.userId;
}

/** An agent idle longer than this (no presence heartbeat) is treated as gone: sweepRouting reassigns their open conversations. */
export const PRESENCE_STALE_MS = 15 * 60_000;

import { asc, count, eq, isNull, lte, ne } from "drizzle-orm";
import { schema } from "@lyra/db";
import { emit, scoped, type Ctx } from "@lyra/core";
import { SWEEP_MAX } from "./sweep.js";

/**
 * How many live conversations each agent is holding right now.
 *
 * orbit_agent_presence.active_count exists but nothing ever writes it, so
 * trusting it made every agent look idle and "least loaded" collapsed into
 * the heartbeat tiebreak. The conversations table already knows the answer,
 * and counting it cannot drift out of step with reality the way an
 * incremented counter does.
 */
async function loadByAssignee(ctx: Ctx): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ assigneeRef: schema.orbitConversations.assigneeRef, open: count() })
    .from(schema.orbitConversations)
    .where(scoped(ctx, schema.orbitConversations, ne(schema.orbitConversations.state, "closed")))
    .groupBy(schema.orbitConversations.assigneeRef);
  return new Map(rows.flatMap((r) => (r.assigneeRef ? [[r.assigneeRef, r.open] as const] : [])));
}

/** Presence as the router sees it: the stored row, with its load counted live. */
function withLoad(
  rows: readonly { userId: string; status: "available" | "away" | "offline"; updatedAt: number }[],
  load: ReadonlyMap<string, number>
): Map<string, PresenceInput> {
  return new Map(rows.map((p) => [p.userId, { status: p.status, updatedAt: p.updatedAt, activeCount: load.get(p.userId) ?? 0 }]));
}

async function defaultTeamId(ctx: Ctx): Promise<string | null> {
  const [team] = await ctx.db
    .select({ id: schema.orbitTeams.id })
    .from(schema.orbitTeams)
    .where(scoped(ctx, schema.orbitTeams, eq(schema.orbitTeams.isDefault, true)));
  return team?.id ?? null;
}

/**
 * Route and assign one conversation, stamping its SLA clock. Called right
 * after a conversation is created (there is no bot->human handover step in
 * this codebase to hook into instead) and again by sweepRouting when a
 * breach or an absent agent forces a re-route.
 *
 * ponytail: a tenant with no default team configured yet gets a no-op, not a
 * throw — every existing inbound-webhook test seeds zero orbit_teams rows,
 * and this must not break inbound processing for a tenant that hasn't set
 * ORBIT teams up yet. Upgrade path: once onboarding always seeds a default
 * team, this branch can go back to throwing on a genuinely misconfigured tenant.
 */
export async function routeConversation(
  ctx: Ctx,
  conversationId: string
): Promise<{ teamId: string | null; assigneeRef: string | null }> {
  const [conversation] = await ctx.db
    .select()
    .from(schema.orbitConversations)
    .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conversationId)));
  if (!conversation) throw new Error(`conversation not found: ${conversationId}`);

  const rules = await ctx.db
    .select({
      seq: schema.orbitRoutingRules.seq,
      teamId: schema.orbitRoutingRules.teamId,
      enabled: schema.orbitRoutingRules.enabled,
      conditionsJson: schema.orbitRoutingRules.conditionsJson
    })
    .from(schema.orbitRoutingRules)
    .where(scoped(ctx, schema.orbitRoutingRules));

  const teamId =
    pickRoute(rules, { channel: conversation.channel, intent: conversation.intent, sentiment: conversation.sentiment }) ??
    (await defaultTeamId(ctx));

  if (!teamId) return { teamId: null, assigneeRef: null };

  const members = await ctx.db
    .select({
      userId: schema.orbitTeamMembers.userId,
      skillsJson: schema.orbitTeamMembers.skillsJson,
      maxConcurrent: schema.orbitTeamMembers.maxConcurrent
    })
    .from(schema.orbitTeamMembers)
    .where(scoped(ctx, schema.orbitTeamMembers, eq(schema.orbitTeamMembers.teamId, teamId)));
  const presenceRows = await ctx.db
    .select()
    .from(schema.orbitAgentPresence)
    .where(scoped(ctx, schema.orbitAgentPresence));
  const presence = withLoad(presenceRows, await loadByAssignee(ctx));
  const requireSkills = conversation.requireSkillsJson ? (JSON.parse(conversation.requireSkillsJson) as string[]) : [];

  // C1/C3: this function is also called mid-flight by sweepRouting's
  // FRT-breach loop to re-route a conversation that is already queued and
  // may already have an owner. A re-route must only ever move `teamId` —
  // the SLA clock and an existing assignee are stamped once, on first-ever
  // routing, and never touched again here. Reassigning away from a live
  // agent is reserved for sweepRouting's stale-presence path, which has its
  // own explicit logic (and its own unassigned-event emit).
  const isFirstAssignment = conversation.assigneeRef === null;
  const assigneeRef = isFirstAssignment ? pickAssignee(members, presence, requireSkills) : conversation.assigneeRef;

  let computedFrtDueAt: number | null = null;
  let computedResolutionDueAt: number | null = null;
  if (conversation.slaPolicyKey) {
    const [policy] = await ctx.db
      .select()
      .from(schema.orbitSlaPolicies)
      .where(scoped(ctx, schema.orbitSlaPolicies, eq(schema.orbitSlaPolicies.key, conversation.slaPolicyKey)));
    if (policy) {
      computedFrtDueAt = ctx.now + policy.frtMinutes * 60_000;
      computedResolutionDueAt = ctx.now + policy.resolutionMinutes * 60_000;
    }
  }
  const queuedAt = conversation.queuedAt ?? ctx.now;
  const firstResponseDueAt = conversation.firstResponseDueAt ?? computedFrtDueAt;
  const resolutionDueAt = conversation.resolutionDueAt ?? computedResolutionDueAt;
  const assignedAt = isFirstAssignment ? (assigneeRef ? ctx.now : null) : conversation.assignedAt;

  await ctx.db
    .update(schema.orbitConversations)
    .set({
      teamId,
      assigneeRef,
      queuedAt,
      assignedAt,
      firstResponseDueAt,
      resolutionDueAt,
      updatedAt: ctx.now
    })
    .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conversationId)));

  return { teamId, assigneeRef };
}

/**
 * Cron tick (gap-orbit-design.md §1B): escalate conversations that missed
 * their SLA clock, and reassign whoever a now-absent agent was holding.
 * Order matters — breach escalation runs first so a conversation reassigned
 * for absence in the same tick already carries its bumped priority.
 */
export async function sweepRouting(
  ctx: Ctx
): Promise<{ frtBreaches: number; resolutionBreaches: number; reassigned: number; unassigned: number }> {
  const frtDue = await ctx.db
    .select({
      id: schema.orbitConversations.id,
      priority: schema.orbitConversations.priority,
      teamId: schema.orbitConversations.teamId,
      firstResponseDueAt: schema.orbitConversations.firstResponseDueAt
    })
    .from(schema.orbitConversations)
    .where(
      scoped(
        ctx,
        schema.orbitConversations,
        isNull(schema.orbitConversations.frtBreachedAt),
        lte(schema.orbitConversations.firstResponseDueAt, ctx.now),
        ne(schema.orbitConversations.state, "closed")
      )
    )
    // Oldest breach first, capped (sweep.ts): breaching stamps frtBreachedAt,
    // so anything past the cap is the next tick's head of queue.
    .orderBy(asc(schema.orbitConversations.firstResponseDueAt))
    .limit(SWEEP_MAX);
  for (const conv of frtDue) {
    const priority = Math.max(0, conv.priority - 1);
    await ctx.db
      .update(schema.orbitConversations)
      .set({ priority, frtBreachedAt: ctx.now, updatedAt: ctx.now })
      .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conv.id)));
    const routed = await routeConversation(ctx, conv.id);
    await emit(ctx, {
      module: "orbit",
      type: "orbit.sla.breached",
      subject: conv.id,
      data: { conversationId: conv.id, kind: "frt", priority, teamId: routed.teamId, dueAt: conv.firstResponseDueAt }
    });
  }

  const resolutionDue = await ctx.db
    .select({
      id: schema.orbitConversations.id,
      priority: schema.orbitConversations.priority,
      teamId: schema.orbitConversations.teamId,
      resolutionDueAt: schema.orbitConversations.resolutionDueAt
    })
    .from(schema.orbitConversations)
    .where(
      scoped(
        ctx,
        schema.orbitConversations,
        isNull(schema.orbitConversations.resolutionBreachedAt),
        lte(schema.orbitConversations.resolutionDueAt, ctx.now),
        ne(schema.orbitConversations.state, "closed")
      )
    )
    .orderBy(asc(schema.orbitConversations.resolutionDueAt))
    .limit(SWEEP_MAX);
  for (const conv of resolutionDue) {
    await ctx.db
      .update(schema.orbitConversations)
      .set({ resolutionBreachedAt: ctx.now, updatedAt: ctx.now })
      .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conv.id)));
    await emit(ctx, {
      module: "orbit",
      type: "orbit.sla.breached",
      subject: conv.id,
      data: { conversationId: conv.id, kind: "resolution", priority: conv.priority, teamId: conv.teamId, dueAt: conv.resolutionDueAt }
    });
  }

  const stalePresence = await ctx.db
    .select()
    .from(schema.orbitAgentPresence)
    .where(scoped(ctx, schema.orbitAgentPresence, eq(schema.orbitAgentPresence.status, "available"), lte(schema.orbitAgentPresence.updatedAt, ctx.now - PRESENCE_STALE_MS)))
    // Longest-quiet agent first, capped: going offline takes the row out of
    // this set. Each one walks its own held conversations, so this is the
    // expensive loop of the three.
    .orderBy(asc(schema.orbitAgentPresence.updatedAt))
    .limit(SWEEP_MAX);

  let reassigned = 0;
  let unassigned = 0;
  for (const stale of stalePresence) {
    await ctx.db
      .update(schema.orbitAgentPresence)
      .set({ status: "offline", updatedAt: ctx.now })
      .where(scoped(ctx, schema.orbitAgentPresence, eq(schema.orbitAgentPresence.id, stale.id)));

    const held = await ctx.db
      .select({
        id: schema.orbitConversations.id,
        teamId: schema.orbitConversations.teamId,
        requireSkillsJson: schema.orbitConversations.requireSkillsJson
      })
      .from(schema.orbitConversations)
      .where(
        scoped(
          ctx,
          schema.orbitConversations,
          eq(schema.orbitConversations.assigneeRef, stale.userId),
          ne(schema.orbitConversations.state, "closed")
        )
      );
    for (const conv of held) {
      if (!conv.teamId) continue;
      const members = await ctx.db
        .select({ userId: schema.orbitTeamMembers.userId, skillsJson: schema.orbitTeamMembers.skillsJson, maxConcurrent: schema.orbitTeamMembers.maxConcurrent })
        .from(schema.orbitTeamMembers)
        .where(scoped(ctx, schema.orbitTeamMembers, eq(schema.orbitTeamMembers.teamId, conv.teamId)));
      const presenceRows = await ctx.db.select().from(schema.orbitAgentPresence).where(scoped(ctx, schema.orbitAgentPresence));
      const presence = withLoad(presenceRows, await loadByAssignee(ctx));
      const requireSkills = conv.requireSkillsJson ? (JSON.parse(conv.requireSkillsJson) as string[]) : [];
      const nextAssignee = pickAssignee(
        members.filter((m) => m.userId !== stale.userId),
        presence,
        requireSkills
      );
      await ctx.db
        .update(schema.orbitConversations)
        .set({ assigneeRef: nextAssignee, assignedAt: nextAssignee ? ctx.now : null, updatedAt: ctx.now })
        .where(scoped(ctx, schema.orbitConversations, eq(schema.orbitConversations.id, conv.id)));
      if (nextAssignee) {
        reassigned++;
      } else {
        unassigned++;
        await emit(ctx, {
          module: "orbit",
          type: "orbit.conversation.unassigned",
          subject: conv.id,
          data: { conversationId: conv.id, teamId: conv.teamId, previousAssigneeRef: stale.userId }
        });
      }
    }
  }

  return { frtBreaches: frtDue.length, resolutionBreaches: resolutionDue.length, reassigned, unassigned };
}
