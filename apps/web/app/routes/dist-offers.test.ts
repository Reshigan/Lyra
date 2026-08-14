import { describe, expect, it } from "vitest";
import { offerSummary } from "./dist-offers";

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
