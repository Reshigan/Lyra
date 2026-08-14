import { describe, expect, it } from "vitest";
import { LABELS, loginHeading, type Step } from "./login";

// The pre-session sign-in screen. The only thing the hero computes is which
// step's title/intro to show — the API decides the step, this file only maps
// it to i18n keys — so that mapping is what gets a test.

describe("loginHeading", () => {
  it.each([
    ["password", "auth.signIn", "auth.intro"],
    ["totp", "auth.totp.title", "auth.totp.intro"],
    ["enrol", "auth.enrol.title", "auth.enrol.intro"],
    ["recovery", "auth.recovery.title", "auth.recovery.intro"]
  ] as const)("maps step %s to its title and intro keys", (step: Step, title, intro) => {
    expect(loginHeading(step)).toEqual({ title, intro });
  });
});

describe("this screen's own labels speak both locales", () => {
  it("has the same keys in en and ar", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("never leaves an Arabic string empty or identical to the English", () => {
    for (const [key, english] of Object.entries(LABELS.en ?? {})) {
      const arabic = LABELS.ar?.[key] ?? "";
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
    }
  });
});
