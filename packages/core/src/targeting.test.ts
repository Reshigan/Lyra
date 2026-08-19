import { describe, expect, it } from "vitest";
import {
  LSM_BANDS,
  PROTECTED_AXES,
  TARGETABLE_AXES,
  countAttributes,
  estimateReach,
  isTargetable,
  lsmBandOf,
  parseAttributeTag,
  targetablePool
} from "./targeting.js";

describe("parseAttributeTag", () => {
  it("reads an axis:value tag", () => {
    expect(parseAttributeTag("lsm:7")).toEqual({ axis: "lsm", value: "7" });
  });

  it("ignores a plain tag with no axis", () => {
    // The tags already on the spine — "vip", "portal-lead" — are not attributes.
    expect(parseAttributeTag("vip")).toBeNull();
    expect(parseAttributeTag("portal-lead")).toBeNull();
  });

  it("keeps a colon inside the value", () => {
    expect(parseAttributeTag("region:kzn:north")).toEqual({ axis: "region", value: "kzn:north" });
  });

  it("normalises case and whitespace on the axis, not the value", () => {
    expect(parseAttributeTag("  AgeBand : 35-44 ")).toEqual({ axis: "ageband", value: "35-44" });
  });

  it("rejects a half-written tag", () => {
    for (const tag of ["lsm:", ":7", ":", "", "   "]) expect(parseAttributeTag(tag)).toBeNull();
  });
});

describe("isTargetable", () => {
  it("accepts every documented targetable axis", () => {
    for (const axis of TARGETABLE_AXES) expect(isTargetable(axis)).toBe(true);
  });

  it("refuses every protected axis (SIG-034)", () => {
    for (const axis of PROTECTED_AXES) expect(isTargetable(axis)).toBe(false);
  });

  it("refuses an axis nobody declared, rather than defaulting open", () => {
    expect(isTargetable("creditscore")).toBe(false);
  });

  it("matches the axis case-insensitively", () => {
    expect(isTargetable("LSM")).toBe(true);
    expect(isTargetable("Religion")).toBe(false);
  });
});

describe("countAttributes", () => {
  it("counts one member per axis:value across customers", () => {
    const counts = countAttributes([
      ["lsm:7", "region:gauteng", "vip"],
      ["lsm:7", "region:gauteng"],
      ["lsm:8", "region:gauteng"]
    ]);
    expect(counts).toEqual([
      { axis: "region", value: "gauteng", count: 3 },
      { axis: "lsm", value: "7", count: 2 },
      { axis: "lsm", value: "8", count: 1 }
    ]);
  });

  it("counts a repeated tag on one customer once", () => {
    expect(countAttributes([["lsm:7", "lsm:7"]])).toEqual([{ axis: "lsm", value: "7", count: 1 }]);
  });

  it("drops a protected axis before it is ever counted", () => {
    // Not filtered later: a protected attribute never becomes a countable cell,
    // so it cannot leak through a caller that forgets to filter.
    expect(countAttributes([["religion:x", "lsm:7"]])).toEqual([{ axis: "lsm", value: "7", count: 1 }]);
  });

  it("ignores tags that are not attributes", () => {
    expect(countAttributes([["vip"], ["portal-lead"]])).toEqual([]);
  });
});

describe("targetablePool", () => {
  const counts = [
    { axis: "lsm", value: "7", count: 40 },
    { axis: "lsm", value: "8", count: 20 },
    { axis: "lsm", value: "9", count: 19 },
    { axis: "region", value: "gauteng", count: 33 }
  ];

  it("suppresses a cell below the k-anonymity floor", () => {
    expect(targetablePool(counts, 20).map((c) => c.value)).toEqual(["7", "gauteng", "8"]);
  });

  it("keeps a cell exactly at the floor", () => {
    expect(targetablePool([{ axis: "lsm", value: "8", count: 20 }], 20)).toHaveLength(1);
  });

  it("uses the SCOUT default floor when none is given", () => {
    expect(targetablePool(counts).every((c) => c.count >= 20)).toBe(true);
  });

  it("returns nothing rather than a thin pool when every cell is suppressed", () => {
    expect(targetablePool(counts, 100)).toEqual([]);
  });
});

describe("estimateReach", () => {
  const counts = [
    { axis: "lsm", value: "7", count: 40 },
    { axis: "lsm", value: "8", count: 30 },
    { axis: "region", value: "gauteng", count: 50 }
  ];

  it("adds values within one axis (they are alternatives)", () => {
    expect(estimateReach([{ axis: "lsm", value: "7" }, { axis: "lsm", value: "8" }], counts)).toBe(70);
  });

  it("takes the smallest axis across axes (they intersect)", () => {
    // Marginal counts cannot give a real intersection; the smaller axis is its
    // ceiling, which is the honest number to show a human.
    expect(
      estimateReach([{ axis: "lsm", value: "7" }, { axis: "region", value: "gauteng" }], counts)
    ).toBe(40);
  });

  it("counts an unknown value as zero rather than guessing", () => {
    expect(estimateReach([{ axis: "lsm", value: "3" }], counts)).toBe(0);
  });

  it("is zero for an empty selection", () => {
    expect(estimateReach([], counts)).toBe(0);
  });
});

describe("lsmBandOf", () => {
  it("reads a band and its descriptor", () => {
    expect(lsmBandOf("7")?.band).toBe(7);
    expect(lsmBandOf("7")?.label).toBeTruthy();
  });

  it("refuses a band off the 1-10 scale", () => {
    for (const v of ["0", "11", "-3", "7.5", "seven", ""]) expect(lsmBandOf(v)).toBeNull();
  });

  it("describes all ten bands exactly once", () => {
    expect(LSM_BANDS.map((b) => b.band)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
