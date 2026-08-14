import { describe, expect, it } from "vitest";
import { LABELS, portalLede } from "./portal.$tenantSlug";

// The public comparison site's hero. The only arithmetic is the product
// count off the catalogue the loader already fetched.

const l = (key: string) => LABELS.en?.[key] ?? key;

describe("portalLede", () => {
  it("narrates the real product count", () => {
    expect(portalLede(l, 5)).toBe("5 products to compare — get a quote in minutes.");
  });

  it("falls back to the plain invitation when there is nothing to count", () => {
    expect(portalLede(l, 0)).toBe(l("portal.intro"));
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
