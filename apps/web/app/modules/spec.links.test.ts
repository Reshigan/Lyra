import { describe, expect, it } from "vitest";
import { visibleLinks, type WorkspaceSpec } from "./spec";

// The link strip under a workspace's tabs (routes/module.tsx). A bespoke screen
// the actor cannot open still degrades to a denied notice rather than a blank —
// but a dead end is not an affordance, so the link is withheld by absence, the
// same rule visibleTabs and visibleActions already follow.
//
// Fixture rather than a real module spec: the links are declared by module
// owners and would otherwise make this a change-detector for their edits.

const spec: WorkspaceSpec = {
  path: "/ledger",
  labels: { en: { open: "Open a transaction", trial: "Trial balance", help: "How this works" } },
  tabs: [],
  links: [
    { href: "/ledger/transactions", labelKey: "open", permission: "ledger:txns:create" },
    { href: "/ledger/reports/trial-balance", labelKey: "trial", permission: "ledger:journals:read" },
    { href: "/ledger/help", labelKey: "help" }
  ]
};

describe("visibleLinks", () => {
  it("withholds a link whose permission the actor does not hold", () => {
    const shown = visibleLinks(spec, ["ledger:journals:read"]);

    expect(shown.map((link) => link.href)).toEqual([
      "/ledger/reports/trial-balance",
      "/ledger/help"
    ]);
    // The withheld one is absent, not disabled: nothing renders it at all.
    expect(shown.some((link) => link.href === "/ledger/transactions")).toBe(false);
  });

  it("offers a link whose permission the actor holds", () => {
    const shown = visibleLinks(spec, ["ledger:txns:create", "ledger:journals:read"]);
    expect(shown).toHaveLength(3);
  });

  it("offers an unrestricted link to an actor holding nothing", () => {
    expect(visibleLinks(spec, []).map((link) => link.href)).toEqual(["/ledger/help"]);
  });

  it("is empty for a workspace that declares no links", () => {
    const { links: _omitted, ...bare } = spec;
    expect(visibleLinks(bare, ["ledger:txns:create"])).toEqual([]);
  });
});
