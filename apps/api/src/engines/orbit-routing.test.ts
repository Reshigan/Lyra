import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";
import { PolicyJson, EntitlementsJson } from "@lyra/db";
import { pickAssignee, pickRoute, routeConversation } from "./orbit-routing.js";

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
});
