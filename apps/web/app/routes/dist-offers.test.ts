import { describe, expect, it } from "vitest";
import { labelsIn, offerSummary } from "./dist-offers";

describe("offerSummary", () => {
  it("counts every offer as surfaceable when permitted and still proposed", () => {
    const offers = [{ state: "proposed" }, { state: "proposed" }];
    expect(offerSummary(offers, true)).toEqual({ total: 2, surfaceable: 2 });
  });

  it("excludes offers already surfaced or declined", () => {
    const offers = [{ state: "proposed" }, { state: "surfaced" }, { state: "declined" }];
    expect(offerSummary(offers, true)).toEqual({ total: 3, surfaceable: 1 });
  });

  it("is zero-surfaceable without the surface permission, regardless of state", () => {
    const offers = [{ state: "proposed" }];
    expect(offerSummary(offers, false)).toEqual({ total: 1, surfaceable: 0 });
  });

  it("is zero-zero on an empty list", () => {
    expect(offerSummary([], true)).toEqual({ total: 0, surfaceable: 0 });
  });
});

describe("labelsIn", () => {
  it("lets the tenant's pack rename the offer kind", () => {
    // `optionLabel(l, "kind", "renewal")` reads "kind.renewal", which the pack
    // owns; without the pack the card called a reorder a renewal.
    expect(labelsIn("en", "retail-ecom")("kind.renewal")).toBe("Reorder");
    expect(labelsIn("ar", "retail-ecom")("kind.renewal")).toBe("إعادة طلب");
  });

  it("keeps the insurance wording when no pack renames it", () => {
    expect(labelsIn("en")("kind.renewal")).toBe("Renewal");
  });
});
