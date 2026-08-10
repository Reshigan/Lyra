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
