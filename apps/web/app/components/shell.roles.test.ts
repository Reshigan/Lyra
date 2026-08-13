import { describe, expect, it, vi } from "vitest";
import { accountMenuItems, profilesFor } from "./shell";

// The role pill switches the view, never the permissions (docs/07 §3, the
// Horizon personas): a profile is the workspace a held role lands on, so a role
// the nav does not offer cannot appear as a place to go.

const t = (key: string) => key;

const nav = [
  { href: "/axis", labelKey: "nav.axis", icon: "axis" },
  { href: "/ledger", labelKey: "nav.ledger", icon: "ledger" }
];

describe("profilesFor", () => {
  it("offers nothing when one role is all there is", () => {
    expect(profilesFor(["axis.agent"], nav, "/axis")).toEqual([]);
  });

  it("offers a profile per role, marking the one on screen", () => {
    const profiles = profilesFor(["axis.agent", "ledger.clerk"], nav, "/axis/cases/abc");
    expect(profiles.map((p) => [p.role, p.href, p.active])).toEqual([
      ["axis.agent", "/axis", true],
      ["ledger.clerk", "/ledger", false]
    ]);
  });

  it("collapses roles that land in the same place", () => {
    // Two AXIS roles are two hats over one workspace, and a menu offering the
    // same destination twice claims a choice that is not there.
    expect(profilesFor(["axis.agent", "axis.lead"], nav, "/axis")).toEqual([]);
  });
});

describe("accountMenuItems with profiles", () => {
  it("lists the profiles above the account actions and blocks the current one", () => {
    const open = vi.fn();
    const items = accountMenuItems(t, open, vi.fn(), [
      { role: "axis.agent", href: "/axis", active: true },
      { role: "ledger.clerk", href: "/ledger", active: false }
    ]);
    expect(items.map((i) => i.id)).toEqual([
      "profile:axis.agent",
      "profile:ledger.clerk",
      "settings",
      "signOut"
    ]);
    expect(items[0]?.disabled).toBe(true);
    items[1]?.onSelect?.();
    expect(open).toHaveBeenCalledWith("/ledger");
  });
});
