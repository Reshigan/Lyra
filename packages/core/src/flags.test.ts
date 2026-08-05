import { describe, expect, it } from "vitest";
import { flagEnabled, type FeatureFlag } from "./flags.js";

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: "north.copilot",
    enabled: true,
    rolloutPercent: 100,
    targetTenantIdsJson: null,
    ...overrides
  };
}

describe("flagEnabled", () => {
  it("the kill-switch always wins, regardless of rollout or allow-list", () => {
    const f = flag({ enabled: false, rolloutPercent: 100, targetTenantIdsJson: JSON.stringify(["ten_a"]) });
    expect(flagEnabled(f, "ten_a")).toBe(false);
  });

  it("an empty allow-list falls through to rollout-percent bucketing (100% always on)", () => {
    const f = flag({ rolloutPercent: 100, targetTenantIdsJson: null });
    expect(flagEnabled(f, "ten_a")).toBe(true);
    expect(flagEnabled(f, "ten_b")).toBe(true);
  });

  it("an empty allow-list falls through to rollout-percent bucketing (0% always off)", () => {
    const f = flag({ rolloutPercent: 0, targetTenantIdsJson: JSON.stringify([]) });
    expect(flagEnabled(f, "ten_a")).toBe(false);
    expect(flagEnabled(f, "ten_b")).toBe(false);
  });

  it("a non-empty allow-list overrides the rollout percent — member in, even at 0%", () => {
    const f = flag({ rolloutPercent: 0, targetTenantIdsJson: JSON.stringify(["ten_a"]) });
    expect(flagEnabled(f, "ten_a")).toBe(true);
  });

  it("a non-empty allow-list overrides the rollout percent — non-member out, even at 100%", () => {
    const f = flag({ rolloutPercent: 100, targetTenantIdsJson: JSON.stringify(["ten_a"]) });
    expect(flagEnabled(f, "ten_b")).toBe(false);
  });

  it("FNV-1a bucket assignment is deterministic for a given flag key and tenant id", () => {
    const f = flag({ rolloutPercent: 50, targetTenantIdsJson: null });
    const first = flagEnabled(f, "ten_repeatable");
    for (let i = 0; i < 10; i++) {
      expect(flagEnabled(f, "ten_repeatable")).toBe(first);
    }
    // Different flag keys hash differently, so the same tenant can land on
    // either side of the same rollout percent for two unrelated flags.
    const other = flagEnabled(flag({ key: "axis.autopilot", rolloutPercent: 50 }), "ten_repeatable");
    expect(typeof other).toBe("boolean");
  });
});
