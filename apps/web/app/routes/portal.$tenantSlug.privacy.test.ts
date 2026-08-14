import { describe, expect, it } from "vitest";
import { LABELS } from "./portal.$tenantSlug.privacy";

// J-C4's public intake. No loader arithmetic to narrate — the hero is title,
// static intro and a real link back to the storefront — so the label table
// is what gets exercised here.

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
