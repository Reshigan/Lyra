import { describe, expect, it } from "vitest";
import { pickAssignee, pickRoute } from "./orbit-routing.js";

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
