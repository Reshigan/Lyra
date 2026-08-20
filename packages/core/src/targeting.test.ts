import { describe, expect, it } from "vitest";
import {
  PROTECTED_AXES,
  affluenceBandOf,
  countAttributes,
  defineTargetingPack,
  estimateReach,
  isTargetable,
  parseAttributeTag,
  targetablePool,
  targetingPack
} from "./targeting.js";

/** The pack a UAE tenant would run on; the ZA default is `targetingPack()`. */
const GULF = "insurance-gulf";

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
  it("accepts every axis the default pack declares", () => {
    for (const axis of targetingPack().axes) expect(isTargetable(axis)).toBe(true);
  });

  it("reads the axis list off the active pack, not off a constant", () => {
    // The commercial case for the seam: a Gulf tenant has no LSM, and an
    // affluence axis it does have must not be refused because ZA never named it.
    expect(isTargetable("incomequintile")).toBe(false);
    expect(isTargetable("incomequintile", GULF)).toBe(true);
    expect(isTargetable("lsm", GULF)).toBe(false);
  });

  it("refuses every protected axis (SIG-034), whichever pack is asking", () => {
    for (const pack of [undefined, GULF, "no-such-pack"])
      for (const axis of PROTECTED_AXES) expect(isTargetable(axis, pack)).toBe(false);
  });

  it("refuses nationality and residency by name, in the pack that wants them", () => {
    // ADR-0071: nationality band is the axis a UAE media buyer asks for first,
    // and it is a proxy for race and ethnic origin. Named here rather than left
    // to the loop above so that deleting it from PROTECTED_AXES fails a test
    // that says why, not just a test that counts.
    for (const axis of ["nationality", "nationalorigin", "residency"])
      expect(isTargetable(axis, GULF)).toBe(false);
    expect(defineTargetingPack(["nationality", "region"], null).axes).toEqual(["region"]);
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

  it("counts the active pack's axes, not the default pack's", () => {
    // A Gulf tenant that still carries a legacy `lsm` tag must not have it
    // counted: the axis is not one this pack sells a media plan on.
    expect(countAttributes([["incomequintile:4", "lsm:7"]], GULF)).toEqual([
      { axis: "incomequintile", value: "4", count: 1 }
    ]);
  });

  it("drops a protected axis before counting whichever pack is active", () => {
    expect(countAttributes([["race:x", "incomequintile:4"]], GULF)).toEqual([
      { axis: "incomequintile", value: "4", count: 1 }
    ]);
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

  it("suppresses an axis the active pack does not target on", () => {
    expect(targetablePool(counts, 20, GULF).map((c) => c.axis)).toEqual(["region"]);
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

describe("affluenceBandOf", () => {
  it("reads a band and its descriptor on the default pack", () => {
    expect(affluenceBandOf("lsm", "7")?.band).toBe(7);
    expect(affluenceBandOf("lsm", "7")?.label).toBe("LSM 7 — upper middle, multiple durables");
  });

  it("refuses a band off the 1-10 scale", () => {
    for (const v of ["0", "11", "-3", "7.5", "seven", ""]) expect(affluenceBandOf("lsm", v)).toBeNull();
  });

  it("refuses a value on an axis that is not the pack's affluence axis", () => {
    // `region:7` is a targetable cell, but it is not a band and must never be
    // labelled as one in a prompt.
    expect(affluenceBandOf("region", "7")).toBeNull();
  });

  it("reads the axis case-insensitively, like every other axis check", () => {
    expect(affluenceBandOf("LSM", "7")?.band).toBe(7);
  });

  it("reads a two-digit band, so the top of the scale is not unreachable", () => {
    expect(affluenceBandOf("lsm", "10")?.band).toBe(10);
  });

  it("takes a padded tag value, which is how a hand-edited tag arrives", () => {
    expect(affluenceBandOf("lsm", " 7 ")?.band).toBe(7);
  });

  it("refuses anything that is not the whole value, however Number() reads it", () => {
    // `7.0` and `+7` both coerce to 7. A band is a tag, not an arithmetic
    // expression: a cell nobody tagged must not be labelled as one.
    for (const v of ["7.0", "+7", "07x", "x7"]) expect(affluenceBandOf("lsm", v)).toBeNull();
  });

  it("reads the Gulf pack's own scale and refuses the ZA one there", () => {
    expect(affluenceBandOf("incomequintile", "5", GULF)?.label).toContain("Q5");
    expect(affluenceBandOf("incomequintile", "6", GULF)).toBeNull();
    expect(affluenceBandOf("lsm", "7", GULF)).toBeNull();
  });

  it("is null for a pack with no affluence axis at all", () => {
    expect(defineTargetingPack(["region"], null).affluence).toBeNull();
  });
});

describe("targetingPack", () => {
  it("keeps the ZA default exactly as it shipped", () => {
    const pack = targetingPack();
    expect(pack.axes).toEqual(["lsm", "ageband", "region", "language", "lifestage"]);
    expect(pack.affluence?.axis).toBe("lsm");
    expect(pack.affluence?.label).toBe("LSM");
    expect(pack.affluence?.bands.map((b) => b.band)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("gives the Gulf pack a different affluence scale on a different axis", () => {
    const pack = targetingPack(GULF);
    expect(pack.axes).not.toContain("lsm");
    expect(pack.axes).toContain("incomequintile");
    expect(pack.affluence?.axis).toBe("incomequintile");
    expect(pack.affluence?.label).toBe("Income quintile");
    expect(pack.affluence?.bands.map((b) => b.band)).toEqual([1, 2, 3, 4, 5]);
  });

  it("degrades an unknown or missing pack to the default rather than to no axes", () => {
    // No affluence axis at all is worse than the wrong one: it is the axis a
    // media plan is bought on, and an empty pack silently un-targets a tenant.
    expect(targetingPack("no-such-pack")).toEqual(targetingPack());
    expect(targetingPack(undefined)).toEqual(targetingPack());
  });

  it("does not read a pack off Object.prototype", () => {
    expect(targetingPack("constructor")).toEqual(targetingPack());
    expect(targetingPack("toString")).toEqual(targetingPack());
  });
});

describe("defineTargetingPack", () => {
  const BANDS = [
    { band: 1, label: "one" },
    { band: 2, label: "two" }
  ];

  it("refuses a protected axis a pack declares targetable", () => {
    // SIG-034 is not a pack's to relax. A pack may name its own axes; it may
    // never name `race` as one of them.
    expect(defineTargetingPack(["race", "region"], null).axes).toEqual(["region"]);
  });

  it("refuses a protected axis dressed up as the affluence scale", () => {
    const pack = defineTargetingPack(["ethnicity", "region"], {
      axis: "ethnicity",
      label: "Group",
      bands: BANDS
    });
    expect(pack.axes).toEqual(["region"]);
    expect(pack.affluence).toBeNull();
  });

  it("refuses an affluence axis the pack never declared targetable", () => {
    const pack = defineTargetingPack(["region"], { axis: "wealth", label: "Wealth", bands: BANDS });
    expect(pack.affluence).toBeNull();
  });

  it("normalises axis case, so a pack cannot smuggle Race past the filter", () => {
    expect(defineTargetingPack(["Race", " Region "], null).axes).toEqual(["region"]);
  });

  it("drops an empty axis, so a stray comma in config cannot become a cell", () => {
    expect(defineTargetingPack(["", "   ", "region"], null).axes).toEqual(["region"]);
  });

  it("keeps the declared axis order, which is the order a UI offers them in", () => {
    expect(defineTargetingPack(["region", "language"], null).axes).toEqual(["region", "language"]);
  });
});
