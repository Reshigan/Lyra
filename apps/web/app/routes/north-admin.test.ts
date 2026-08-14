import { describe, expect, it } from "vitest";
import { freshness, headline, targetFrom, targetValue } from "./north-admin";

const DAY = 86_400_000;
const NOW = 1_770_000_000_000;
const l = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

const metric = (key: string, grain: "day" | "week" | "month" = "day") => ({ key, grain });

describe("freshness", () => {
  it("gives a daily metric one missed night before calling it late", () => {
    expect(freshness(NOW - 6 * 3600_000, "day", NOW)).toBe("fresh");
    expect(freshness(NOW - 3 * DAY, "day", NOW)).toBe("late");
  });

  it("holds a weekly metric to a week's patience and a monthly one to a month's", () => {
    expect(freshness(NOW - 6 * DAY, "week", NOW)).toBe("fresh");
    expect(freshness(NOW - 12 * DAY, "week", NOW)).toBe("late");
    expect(freshness(NOW - 30 * DAY, "month", NOW)).toBe("fresh");
    expect(freshness(NOW - 50 * DAY, "month", NOW)).toBe("late");
  });

  it("reads a metric that has never been snapshotted as missing, not as late", () => {
    expect(freshness(null, "day", NOW)).toBe("missing");
  });

  it("treats an unknown grain as daily rather than silently passing it", () => {
    expect(freshness(NOW - 3 * DAY, "quarter", NOW)).toBe("late");
  });
});

describe("targetValue", () => {
  it("reads the seeded target, whether the column arrives as text or as an object", () => {
    const seeded = { value: 230_000_000, scale: "minor", currency: "AED" };
    expect(targetValue(JSON.stringify(seeded))).toBe(230_000_000);
    expect(targetValue(seeded)).toBe(230_000_000);
  });

  it("returns nothing rather than throwing when no target is set or the column holds junk", () => {
    expect(targetValue(null)).toBeNull();
    expect(targetValue("not json")).toBeNull();
    expect(targetValue({ scale: "minor" })).toBeNull();
    expect(targetValue({ value: "230" })).toBeNull();
  });
});

describe("targetFrom", () => {
  it("keeps the scale and currency the registry already recorded", () => {
    expect(targetFrom("240000000", { value: 230_000_000, scale: "minor", currency: "AED" })).toEqual({
      value: 240_000_000,
      scale: "minor",
      currency: "AED"
    });
  });

  it("writes a bare value when the metric had no target before", () => {
    expect(targetFrom("400", null)).toEqual({ value: 400 });
  });

  it("clears the target when the box is emptied", () => {
    expect(targetFrom("", { value: 1, scale: "minor" })).toBeNull();
    expect(targetFrom("  ", null)).toBeNull();
  });

  it("refuses a value that is not a number, so a typo cannot blank a target", () => {
    expect(targetFrom("soon", { value: 1 })).toBe("bad");
    expect(targetFrom("12abc", null)).toBe("bad");
  });
});

describe("headline", () => {
  it("says so when the registry itself could not be read", () => {
    expect(headline(null, [], NOW, l)).toBe("headline.denied");
  });

  it("falls back to the page title for an empty registry — nothing to tally yet", () => {
    expect(headline([], [], NOW, l)).toBe("title");
  });

  it("calls every metric fed when each one is within its own grain's patience", () => {
    const metrics = [metric("gwp_month", "day"), metric("loss_ratio", "day")];
    const health = [
      { metricKey: "gwp_month", lastSnapshotAt: NOW - 6 * 3600_000 },
      { metricKey: "loss_ratio", lastSnapshotAt: NOW - 12 * 3600_000 }
    ];
    expect(headline(metrics, health, NOW, l)).toBe("headline.fresh");
  });

  it("counts the ones that have gone quiet, by the same freshness() the table reads", () => {
    const metrics = [metric("gwp_month", "day"), metric("loss_ratio", "day"), metric("nps", "day")];
    const health = [
      { metricKey: "gwp_month", lastSnapshotAt: NOW - 3 * DAY }, // late
      { metricKey: "loss_ratio", lastSnapshotAt: NOW - 6 * 3600_000 } // fresh
      // nps: never snapshotted — missing
    ];
    expect(headline(metrics, health, NOW, l)).toBe("headline.unfed:2");
  });
});
