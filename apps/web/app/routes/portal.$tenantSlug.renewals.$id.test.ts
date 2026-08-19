import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LABELS, referenceLabel, renewalStance } from "./portal.$tenantSlug.renewals.$id";

// J-C3's hosted page. The state machine decides what a stranger holding the link
// is allowed to be offered, so it is a pure function tested here rather than a
// tangle of JSX conditions tested nowhere.

const l = (key: string) => LABELS.en?.[key] ?? key;
const NOW = 1_760_000_000_000;
const base = { reference: "POL-1", expiryAt: NOW + 86_400_000, state: "offered", decidedAt: null };

describe("renewalStance", () => {
  it("offers the tap while the term is live", () => {
    expect(renewalStance(base, NOW)).toBe("open");
  });

  it("thanks a customer who already tapped, even after the term runs out", () => {
    expect(renewalStance({ ...base, state: "accepted", decidedAt: NOW }, NOW)).toBe("accepted");
    expect(renewalStance({ ...base, state: "accepted", expiryAt: NOW - 1 }, NOW)).toBe("accepted");
  });

  it("offers nothing on a renewal the desk closed", () => {
    expect(renewalStance({ ...base, state: "lost" }, NOW)).toBe("closed");
  });

  it("offers nothing once the term has ended", () => {
    expect(renewalStance({ ...base, expiryAt: NOW - 1 }, NOW)).toBe("expired");
    // The boundary is inclusive: the last millisecond of cover is still cover.
    expect(renewalStance({ ...base, expiryAt: NOW }, NOW)).toBe("open");
  });

  it("never opens a state it does not know", () => {
    expect(renewalStance({ ...base, state: "scheduled" }, NOW)).toBe("open");
  });
});

describe("referenceLabel", () => {
  it("uses the tenant's own noun when its domain pack renames one", () => {
    expect(referenceLabel(l, "retail-ecom", "en")).toBe("Order reference");
    expect(referenceLabel(l, "retail-ecom", "ar")).toBe("مرجع الطلب");
  });

  it("falls back to this screen's label for a pack with no opinion", () => {
    expect(referenceLabel(l, "insurance-retail", "en")).toBe("Reference");
    expect(referenceLabel(l, undefined, "en")).toBe("Reference");
  });
});

describe("the page carries the tenant's brand, never ours", () => {
  it("has no hard-coded platform name anywhere in the surface", () => {
    const source = readFileSync(join(import.meta.dirname, "portal.$tenantSlug.renewals.$id.tsx"), "utf8");
    expect(source).not.toMatch(/\bLYRA\b/);
    expect(source).not.toMatch(/\bHorizon\b/);
    // Every visible string is a label key, and no label names a company.
    for (const table of Object.values(LABELS)) {
      for (const value of Object.values(table)) expect(value).not.toMatch(/LYRA/i);
    }
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
