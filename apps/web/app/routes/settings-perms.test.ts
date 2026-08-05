import { describe, expect, it } from "vitest";
import { byModule } from "./settings";

// The "what this account may do" panel and the API-key scope picker both read the
// same grouping. If it drops a permission a person is told they cannot do
// something they can, so the grouping is checked rather than eyeballed.

describe("byModule", () => {
  it("groups by the first segment and keeps every permission", () => {
    const grouped = byModule(["core:users:read", "axis:cases:write", "core:pii:view"]);
    expect([...grouped.keys()]).toEqual(["core", "axis"]);
    expect(grouped.get("core")).toEqual(["core:users:read", "core:pii:view"]);
    expect([...grouped.values()].flat()).toHaveLength(3);
  });

  it("has no groups when the account holds nothing", () => {
    expect(byModule([]).size).toBe(0);
  });
});
