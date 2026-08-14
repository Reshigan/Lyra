import { describe, expect, it } from "vitest";
import { settingsLede } from "./settings";

// The settings hero is shared by every tab, not only the one where the inbox
// itself lives, so the only thing worth narrating there is a real unread
// count — never a fabricated summary of a tab the actor isn't looking at.
const label = (key: string): string =>
  key === "settings.introUnread" ? "{count} unread notification(s) below." : key;

describe("settingsLede", () => {
  it("falls back to the static intro when nothing is unread", () => {
    expect(settingsLede(0, label)).toBe("settings.intro");
  });

  it("counts unread notifications into the template", () => {
    expect(settingsLede(3, label)).toBe("3 unread notification(s) below.");
  });
});
