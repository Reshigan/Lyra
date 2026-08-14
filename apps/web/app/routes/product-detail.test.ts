import { describe, expect, it } from "vitest";
import { LABELS, PERM, channelKeysOf, labelsIn, productLede } from "./product-detail";
import type { OfferingRow } from "./product-detail";

// Read-only screen: no action to exercise. What can break is the labelling and
// the derivation of "which channels distribute this", which has no join table —
// it is the union of each version's channel allow-list, and a null list means
// every channel, which the screen must not render as "none".

function offering(channelKeysJson: OfferingRow["channelKeysJson"]): OfferingRow {
  return { id: "off_1", code: "C", nameJson: null, channelKeysJson } as OfferingRow;
}

describe("labelsIn", () => {
  it("answers every key in both languages, and never with the key itself", () => {
    for (const key of Object.keys(LABELS.en!)) {
      expect(LABELS.ar![key], key).toBeTruthy();
      for (const locale of ["en", "ar"]) expect(labelsIn(locale)(key), `${locale}:${key}`).not.toBe(key);
    }
    expect(Object.keys(LABELS.ar!).sort()).toEqual(Object.keys(LABELS.en!).sort());
  });

  it("keeps the Arabic distinct from the English", () => {
    for (const [key, value] of Object.entries(LABELS.en!)) expect(LABELS.ar![key], key).not.toBe(value);
  });

  it("takes the pack's word for cover before its own", () => {
    expect(labelsIn("en", "retail-ecom")("coverageJson")).toBe("Entitlements");
  });
});

describe("productLede", () => {
  it("states the line, status and version count from the loaded record", () => {
    expect(productLede({ line: "motor", status: "active" }, 3, labelsIn("en"))).toBe("Motor · Active · 3 versions");
  });
});

describe("PERM", () => {
  it("scopes each panel to its own permission so one refusal hides one panel", () => {
    const values = Object.values(PERM);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => /^[a-z_]+:[a-z_]+:[a-z_]+$/.test(value))).toBe(true);
  });
});

describe("channelKeysOf", () => {
  it("unions the allow-lists across versions, without duplicates", () => {
    expect(channelKeysOf([offering(["web", "broker"]), offering(["broker", "app"])])).toEqual([
      "web",
      "broker",
      "app"
    ]);
  });

  it("reports no keys when a version is open to every channel", () => {
    expect(channelKeysOf([offering(null)])).toEqual([]);
  });

  it("ignores a malformed allow-list instead of throwing", () => {
    expect(channelKeysOf([offering("web" as unknown as string[]), offering([1 as unknown as string, "web"])])).toEqual([
      "web"
    ]);
  });

  it("has nothing to say about no versions", () => {
    expect(channelKeysOf([])).toEqual([]);
  });
});
