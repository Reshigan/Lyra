import { describe, expect, it, vi } from "vitest";
import { accountMenuItems } from "./shell";

// The account controls were two flat text links and a name pill — docs/ui.md
// §7.4 counts the missing user menu as one of the five shell pieces the design
// system already ships. The items are a pure list so the menu's contents can be
// read without a router.

const t = (key: string) => key;

describe("accountMenuItems", () => {
  it("offers settings and sign-out, and marks the destructive one", () => {
    const items = accountMenuItems(t, vi.fn(), vi.fn());
    expect(items.map((i) => i.id)).toEqual(["settings", "signOut"]);
    expect(items.map((i) => i.label)).toEqual(["header.settings", "header.signOut"]);
    expect(items.find((i) => i.id === "signOut")?.tone).toBe("danger");
  });

  it("opens settings by navigation, not by posting a form", () => {
    const open = vi.fn();
    const signOut = vi.fn();
    const items = accountMenuItems(t, open, signOut);
    items.find((i) => i.id === "settings")?.onSelect?.();
    expect(open).toHaveBeenCalledWith("/settings");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out through the same POST /logout the form used", () => {
    const signOut = vi.fn();
    const items = accountMenuItems(t, vi.fn(), signOut);
    items.find((i) => i.id === "signOut")?.onSelect?.();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
