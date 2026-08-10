import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { PolicyJson, EntitlementsJson } from "@lyra/db";
import { pickAssignee, pickRoute, routeConversation, sweepRouting, PRESENCE_STALE_MS } from "./orbit-routing.js";

describe("pickRoute", () => {
  const rule = (seq: number, teamId: string, conditions: object, enabled = true) => ({
    seq,
    teamId,
    enabled,
    conditionsJson: JSON.stringify(conditions)
  });

  it("picks the first matching rule by seq, not insertion order", () => {
    const rules = [rule(2, "team_b", { channel: "whatsapp" }), rule(1, "team_a", { channel: "whatsapp" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBe("team_a");
  });

  it("skips a disabled rule even when it would otherwise match", () => {
    const rules = [rule(1, "team_a", { channel: "whatsapp" }, false), rule(2, "team_b", { channel: "whatsapp" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBe("team_b");
  });

  it("matches on a sentiment-below threshold", () => {
    const rules = [rule(1, "escalation", { sentimentBelow: -20 })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: -50 })).toBe("escalation");
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: -10 })).toBeNull();
    expect(pickRoute(rules, { channel: "whatsapp", intent: null, sentiment: null })).toBeNull();
  });

  it("requires every present condition to match, treating an omitted field as a wildcard", () => {
    const rules = [rule(1, "claims_team", { channel: "whatsapp", intent: "claim" })];
    expect(pickRoute(rules, { channel: "whatsapp", intent: "claim", sentiment: null })).toBe("claims_team");
    expect(pickRoute(rules, { channel: "email", intent: "claim", sentiment: null })).toBeNull();
  });

  it("returns null when no rule matches, leaving fallback-to-default-team to the caller", () => {
    expect(pickRoute([], { channel: "whatsapp", intent: null, sentiment: null })).toBeNull();
  });
});

describe("pickAssignee", () => {
  const member = (userId: string, skills: string[] = [], maxConcurrent = 3) => ({
    userId,
    skillsJson: JSON.stringify(skills),
    maxConcurrent
  });
  const available = (activeCount: number, updatedAt: number) => ({ status: "available" as const, activeCount, updatedAt });

  it("excludes an agent already at their concurrency ceiling", () => {
    const members = [member("u1", [], 1), member("u2", [], 3)];
    const presence = new Map([
      ["u1", available(1, 100)],
      ["u2", available(0, 100)]
    ]);
    expect(pickAssignee(members, presence, [])).toBe("u2");
  });

  it("excludes an agent missing a required skill", () => {
    const members = [member("u1", ["motor"]), member("u2", ["claims"])];
    const presence = new Map([
      ["u1", available(0, 100)],
      ["u2", available(0, 100)]
    ]);
    expect(pickAssignee(members, presence, ["claims"])).toBe("u2");
  });

  it("picks the least-loaded agent, then the longest-idle, then the lowest userId", () => {
    const members = [member("u1"), member("u2"), member("u3")];
    const presence = new Map([
      ["u1", available(2, 100)],
      ["u2", available(0, 200)], // fewest active (0), wins outright
      ["u3", available(1, 150)]
    ]);
    expect(pickAssignee(members, presence, [])).toBe("u2"); // fewest active

    const tiedLoad = new Map([
      ["u1", available(0, 200)], // idle since 200 (more recently active)
      ["u2", available(0, 100)], // idle since 100 (longest idle) -> wins
      ["u3", available(0, 100)] // tied idle time with u2 -> userId tiebreak, but u2 < u3
    ]);
    expect(pickAssignee(members, tiedLoad, [])).toBe("u2");
  });

  it("returns null when nobody is available", () => {
    const members = [member("u1")];
    const presence = new Map([["u1", { status: "away" as const, activeCount: 0, updatedAt: 100 }]]);
    expect(pickAssignee(members, presence, [])).toBeNull();
  });

  it("returns null when a member has no presence row at all", () => {
    const members = [member("u1")];
    expect(pickAssignee(members, new Map(), [])).toBeNull();
  });
});

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "packages", "db", "migrations");
const tenantId = "t_1";
const now = 1_700_000_000_000;

function statements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("routeConversation", () => {
  let client: Client;
  let ctx: Ctx;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    for (const sql of statements()) await client.execute(sql);
    const db = drizzle(client) as unknown as Ctx["db"];
    ctx = {
      db,
      tenantId,
      actor: { kind: "system", id: "test", tenantId, grants: [] },
      requestId: "req_1",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await db.insert(schema.orbitConversations).values({
      id: "cnv_1",
      tenantId,
      channel: "whatsapp",
      state: "bot",
      createdAt: now,
      updatedAt: now
    });
  });

  it("routes to the default team and assigns the least-loaded available agent", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitTeamMembers).values({
      id: "tmm_1",
      tenantId,
      teamId: "otm_default",
      userId: "u_1",
      createdAt: now
    });
    await ctx.db.insert(schema.orbitAgentPresence).values({
      id: "ap_1",
      tenantId,
      userId: "u_1",
      status: "available",
      activeCount: 0,
      updatedAt: now
    });

    const result = await routeConversation(ctx, "cnv_1");
    expect(result).toEqual({ teamId: "otm_default", assigneeRef: "u_1" });

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.teamId).toBe("otm_default");
    expect(row!.assigneeRef).toBe("u_1");
    expect(row!.queuedAt).toBe(now);
    expect(row!.assignedAt).toBe(now);
  });

  it("routes via a matching rule instead of the default team when one matches", async () => {
    await ctx.db.insert(schema.orbitTeams).values([
      { id: "otm_default", tenantId, key: "default", nameJson: "{}", isDefault: true, createdAt: now, updatedAt: now },
      { id: "otm_claims", tenantId, key: "claims", nameJson: "{}", isDefault: false, createdAt: now, updatedAt: now }
    ]);
    await ctx.db.insert(schema.orbitRoutingRules).values({
      id: "rr_1",
      tenantId,
      teamId: "otm_claims",
      seq: 1,
      enabled: true,
      conditionsJson: JSON.stringify({ channel: "whatsapp" }),
      createdAt: now,
      updatedAt: now
    });

    const result = await routeConversation(ctx, "cnv_1");
    expect(result.teamId).toBe("otm_claims");
  });

  it("leaves the conversation unrouted, without throwing, when the tenant has no team configured yet", async () => {
    const result = await routeConversation(ctx, "cnv_1");
    expect(result).toEqual({ teamId: null, assigneeRef: null });

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.teamId).toBeNull();
    expect(row!.assigneeRef).toBeNull();
    expect(row!.queuedAt).toBeNull();
  });

  it("stamps SLA due timestamps from the conversation's SLA policy, and leaves them null when none is configured", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitSlaPolicies).values({
      id: "slp_1",
      tenantId,
      key: "default",
      frtMinutes: 15,
      resolutionMinutes: 240,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db
      .update(schema.orbitConversations)
      .set({ slaPolicyKey: "default" })
      .where(eq(schema.orbitConversations.id, "cnv_1"));

    await routeConversation(ctx, "cnv_1");
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(row!.firstResponseDueAt).toBe(now + 15 * 60_000);
    expect(row!.resolutionDueAt).toBe(now + 240 * 60_000);
  });

  // Regression test for C1: sweepRouting's FRT-breach loop calls
  // routeConversation a second time on an already-queued conversation. That
  // must never push the SLA clock forward or reset queue position.
  it("preserves queuedAt, firstResponseDueAt and resolutionDueAt on a second, re-route call", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitSlaPolicies).values({
      id: "slp_1",
      tenantId,
      key: "default",
      frtMinutes: 15,
      resolutionMinutes: 240,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.update(schema.orbitConversations).set({ slaPolicyKey: "default" }).where(eq(schema.orbitConversations.id, "cnv_1"));
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_1", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_1", tenantId, userId: "u_1", status: "available", activeCount: 0, updatedAt: now });

    await routeConversation(ctx, "cnv_1");
    const [first] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(first!.queuedAt).toBe(now);
    expect(first!.firstResponseDueAt).toBe(now + 15 * 60_000);
    expect(first!.resolutionDueAt).toBe(now + 240 * 60_000);

    const later: Ctx = { ...ctx, now: now + 5 * 60_000 };
    await routeConversation(later, "cnv_1");
    const [second] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(second!.queuedAt).toBe(first!.queuedAt);
    expect(second!.firstResponseDueAt).toBe(first!.firstResponseDueAt);
    expect(second!.resolutionDueAt).toBe(first!.resolutionDueAt);
  });

  // Regression test for C3: a routine re-route (not the stale-presence path)
  // must not poach a conversation away from an agent who already owns it,
  // even when a more attractive candidate becomes available in the interim.
  it("keeps an existing assignee on a second re-route even when a less-loaded agent later becomes available", async () => {
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_1", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_1", tenantId, userId: "u_1", status: "available", activeCount: 1, updatedAt: now });

    await routeConversation(ctx, "cnv_1");
    const [first] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(first!.assigneeRef).toBe("u_1");

    // A less-loaded agent joins the team after first routing — a routine
    // re-route must not hand the conversation to them.
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_2", tenantId, teamId: "otm_default", userId: "u_0", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_2", tenantId, userId: "u_0", status: "available", activeCount: 0, updatedAt: now });

    await routeConversation(ctx, "cnv_1");
    const [second] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_1"));
    expect(second!.assigneeRef).toBe("u_1");
  });
});

describe("sweepRouting", () => {
  let client: Client;
  let ctx: Ctx;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    for (const sql of statements()) await client.execute(sql);
    const db = drizzle(client) as unknown as Ctx["db"];
    ctx = {
      db,
      tenantId,
      actor: { kind: "system", id: "test", tenantId, grants: [] },
      requestId: "req_1",
      now,
      locale: "en",
      policy: PolicyJson.parse({}),
      entitlements: EntitlementsJson.parse({})
    };
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_default",
      tenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
  });

  it("bumps priority down by one and re-routes a conversation that missed its first-response SLA", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_1", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({ id: "ap_1", tenantId, userId: "u_1", status: "available", activeCount: 0, updatedAt: now });
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_frt",
      tenantId,
      channel: "whatsapp",
      state: "bot",
      priority: 2,
      firstResponseDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.frtBreaches).toBe(1);

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_frt"));
    expect(row!.priority).toBe(1);
    expect(row!.frtBreachedAt).toBe(now);
    expect(row!.teamId).toBe("otm_default");
    expect(row!.assigneeRef).toBe("u_1");

    const events = await ctx.db.select().from(schema.eventOutbox);
    const breach = events.find((e) => JSON.parse(e.envelopeJson).type === "orbit.sla.breached");
    expect(JSON.parse(breach!.envelopeJson).data).toEqual({
      conversationId: "cnv_frt",
      kind: "frt",
      priority: 1,
      teamId: "otm_default",
      dueAt: now - 1
    });
  });

  it("does not bump priority for a resolution-SLA breach, and does not re-fire on a second sweep", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_res",
      tenantId,
      channel: "whatsapp",
      state: "human",
      priority: 2,
      resolutionDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    await sweepRouting(ctx);
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_res"));
    expect(row!.priority).toBe(2);
    expect(row!.resolutionBreachedAt).toBe(now);

    const events = await ctx.db.select().from(schema.eventOutbox);
    expect(events.filter((e) => JSON.parse(e.envelopeJson).type === "orbit.sla.breached")).toHaveLength(1);

    await sweepRouting(ctx); // idempotent: already-breached rows are not touched again
    const eventsAfter = await ctx.db.select().from(schema.eventOutbox);
    expect(eventsAfter).toHaveLength(1);
  });

  it("does not touch a closed conversation even if its SLA timestamps are in the past", async () => {
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_closed",
      tenantId,
      channel: "whatsapp",
      state: "closed",
      priority: 2,
      firstResponseDueAt: now - 1,
      resolutionDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.frtBreaches).toBe(0);
    expect(result.resolutionBreaches).toBe(0);
  });

  it("reassigns an open conversation whose agent's presence has gone stale, marking them offline", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values([
      { id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_stale", createdAt: now },
      { id: "tmm_2", tenantId, teamId: "otm_default", userId: "u_fresh", createdAt: now }
    ]);
    await ctx.db.insert(schema.orbitAgentPresence).values([
      { id: "ap_1", tenantId, userId: "u_stale", status: "available", activeCount: 1, updatedAt: now - PRESENCE_STALE_MS - 1 },
      { id: "ap_2", tenantId, userId: "u_fresh", status: "available", activeCount: 0, updatedAt: now }
    ]);
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_stale",
      tenantId,
      channel: "whatsapp",
      state: "human",
      teamId: "otm_default",
      assigneeRef: "u_stale",
      priority: 2,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.reassigned).toBe(1);

    const [staleAgent] = await ctx.db.select().from(schema.orbitAgentPresence).where(eq(schema.orbitAgentPresence.userId, "u_stale"));
    expect(staleAgent!.status).toBe("offline");

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_stale"));
    expect(row!.assigneeRef).toBe("u_fresh");
  });

  it("unassigns (instead of throwing) and emits orbit.conversation.unassigned when nobody else is available", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_stale", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({
      id: "ap_1",
      tenantId,
      userId: "u_stale",
      status: "available",
      activeCount: 1,
      updatedAt: now - PRESENCE_STALE_MS - 1
    });
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_alone",
      tenantId,
      channel: "whatsapp",
      state: "human",
      teamId: "otm_default",
      assigneeRef: "u_stale",
      priority: 2,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    await sweepRouting(ctx);
    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_alone"));
    expect(row!.assigneeRef).toBeNull();

    const events = await ctx.db.select().from(schema.eventOutbox);
    const unassignedEvent = events.find((e) => JSON.parse(e.envelopeJson).type === "orbit.conversation.unassigned");
    expect(unassignedEvent).toBeDefined();
    expect(JSON.parse(unassignedEvent!.envelopeJson).data).toEqual({
      conversationId: "cnv_alone",
      teamId: "otm_default",
      previousAssigneeRef: "u_stale"
    });
  });

  // Regression test for I3: the stale-presence reassignment loop must honor
  // the conversation's requireSkillsJson instead of hardcoding no requirement
  // — otherwise it can hand a skill-gated conversation to an unqualified agent.
  it("honors requireSkillsJson when reassigning a stale agent's conversation", async () => {
    await ctx.db.insert(schema.orbitTeamMembers).values([
      { id: "tmm_1", tenantId, teamId: "otm_default", userId: "u_stale", createdAt: now },
      // more idle (would win the tiebreak) but lacks the required skill
      { id: "tmm_2", tenantId, teamId: "otm_default", userId: "u_no_skill", skillsJson: JSON.stringify([]), createdAt: now },
      { id: "tmm_3", tenantId, teamId: "otm_default", userId: "u_skilled", skillsJson: JSON.stringify(["claims"]), createdAt: now }
    ]);
    await ctx.db.insert(schema.orbitAgentPresence).values([
      { id: "ap_1", tenantId, userId: "u_stale", status: "available", activeCount: 1, updatedAt: now - PRESENCE_STALE_MS - 1 },
      { id: "ap_2", tenantId, userId: "u_no_skill", status: "available", activeCount: 0, updatedAt: now - 1000 },
      { id: "ap_3", tenantId, userId: "u_skilled", status: "available", activeCount: 0, updatedAt: now }
    ]);
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_skill_gated",
      tenantId,
      channel: "whatsapp",
      state: "human",
      teamId: "otm_default",
      assigneeRef: "u_stale",
      requireSkillsJson: JSON.stringify(["claims"]),
      priority: 2,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.reassigned).toBe(1);

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_skill_gated"));
    expect(row!.assigneeRef).toBe("u_skilled");
  });

  // Regression test for tenant isolation: a sweep run for one tenant must
  // never touch, count, or reassign another tenant's conversations.
  it("does not touch another tenant's breached or stale-agent conversations", async () => {
    const otherTenantId = "t_2";
    await ctx.db.insert(schema.orbitTeams).values({
      id: "otm_other",
      tenantId: otherTenantId,
      key: "default",
      nameJson: "{}",
      isDefault: true,
      createdAt: now,
      updatedAt: now
    });
    await ctx.db.insert(schema.orbitTeamMembers).values({ id: "tmm_other", tenantId: otherTenantId, teamId: "otm_other", userId: "u_other", createdAt: now });
    await ctx.db.insert(schema.orbitAgentPresence).values({
      id: "ap_other",
      tenantId: otherTenantId,
      userId: "u_other_stale",
      status: "available",
      activeCount: 1,
      updatedAt: now - PRESENCE_STALE_MS - 1
    });
    await ctx.db.insert(schema.orbitConversations).values({
      id: "cnv_other_frt",
      tenantId: otherTenantId,
      channel: "whatsapp",
      state: "bot",
      teamId: "otm_other",
      assigneeRef: "u_other_stale",
      priority: 2,
      firstResponseDueAt: now - 1,
      createdAt: now - 1000,
      updatedAt: now - 1000
    });

    const result = await sweepRouting(ctx);
    expect(result.frtBreaches).toBe(0);
    expect(result.reassigned).toBe(0);
    expect(result.unassigned).toBe(0);

    const [row] = await ctx.db.select().from(schema.orbitConversations).where(eq(schema.orbitConversations.id, "cnv_other_frt"));
    expect(row!.priority).toBe(2);
    expect(row!.frtBreachedAt).toBeNull();
    expect(row!.assigneeRef).toBe("u_other_stale");

    const [otherPresence] = await ctx.db.select().from(schema.orbitAgentPresence).where(eq(schema.orbitAgentPresence.userId, "u_other_stale"));
    expect(otherPresence!.status).toBe("available");
  });
});
