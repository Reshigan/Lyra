import { describe, expect, it } from "vitest";
import { moduleName, translator } from "../i18n";
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

// The group heading is what a person scans; it printed the storage key, so the
// panel read "ai (7)" and "dist (2)" where module names belong.
describe("group headings", () => {
  const t = translator("en");

  it("says each module the way the nav says it", () => {
    expect(moduleName(t, "dist")).toBe("Distribution");
    expect(moduleName(t, "axis")).toBe("Operations");
    expect(moduleName(t, "ai")).toBe("AI services");
  });
});
