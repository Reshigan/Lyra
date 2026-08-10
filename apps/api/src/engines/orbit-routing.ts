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

import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { scoped, type Ctx } from "@lyra/core";

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
  // ponytail: the presence.status column is plain `text` in the schema (no
  // narrowed enum type), so the select comes back as `string`; cast to
  // pickAssignee's union here rather than adding a schema-level enum for one call site.
  const presence = new Map(
    presenceRows.map((p) => [p.userId, { ...p, status: p.status as PresenceInput["status"] }])
  );
  const requireSkills = conversation.requireSkillsJson ? (JSON.parse(conversation.requireSkillsJson) as string[]) : [];
  const assigneeRef = pickAssignee(members, presence, requireSkills);

  let firstResponseDueAt: number | null = null;
  let resolutionDueAt: number | null = null;
  if (conversation.slaPolicyKey) {
    const [policy] = await ctx.db
      .select()
      .from(schema.orbitSlaPolicies)
      .where(scoped(ctx, schema.orbitSlaPolicies, eq(schema.orbitSlaPolicies.key, conversation.slaPolicyKey)));
    if (policy) {
      firstResponseDueAt = ctx.now + policy.frtMinutes * 60_000;
      resolutionDueAt = ctx.now + policy.resolutionMinutes * 60_000;
    }
  }

  await ctx.db
    .update(schema.orbitConversations)
    .set({
      teamId,
      assigneeRef,
      queuedAt: ctx.now,
      assignedAt: assigneeRef ? ctx.now : null,
      firstResponseDueAt,
      resolutionDueAt,
      updatedAt: ctx.now
    })
    .where(eq(schema.orbitConversations.id, conversationId));

  return { teamId, assigneeRef };
}
