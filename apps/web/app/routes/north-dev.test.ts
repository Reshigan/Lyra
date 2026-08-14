import { describe, expect, it } from "vitest";
import { curlFor, headline, periodFor, validPeriod } from "./north-dev";

// 2026-08-13T09:00:00Z — mid-morning, so "yesterday" is unambiguous.
const NOW = Date.UTC(2026, 7, 13, 9, 0, 0);
const l = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

describe("periodFor", () => {
  it("offers yesterday for a day, because today's row is not written until it closes", () => {
    expect(periodFor("day", NOW)).toBe("2026-08-12");
  });

  it("offers the current month, which the snapshotter keeps month-to-date", () => {
    expect(periodFor("month", NOW)).toBe("2026-08");
  });

  it("steps back over a month boundary rather than producing a day zero", () => {
    expect(periodFor("day", Date.UTC(2026, 8, 1, 3, 0, 0))).toBe("2026-08-31");
  });
});

describe("validPeriod", () => {
  it("holds each grain to the shape the snapshotter writes", () => {
    expect(validPeriod("day", "2026-08-12")).toBe(true);
    expect(validPeriod("day", "2026-08")).toBe(false);
    expect(validPeriod("month", "2026-08")).toBe(true);
    expect(validPeriod("month", "2026-08-12")).toBe(false);
  });

  it("rejects a blank or malformed period instead of sending it to the API", () => {
    expect(validPeriod("day", "")).toBe(false);
    expect(validPeriod("day", "  ")).toBe(false);
    expect(validPeriod("day", "12-08-2026")).toBe(false);
    expect(validPeriod("month", "2026-8")).toBe(false);
  });
});

describe("curlFor", () => {
  it("writes a request an integrator can paste, with the keys they picked", () => {
    const curl = curlFor("https://api.example.com", {
      metricKeys: ["gwp_month", "loss_ratio"],
      grain: "month",
      period: "2026-08"
    });
    expect(curl).toContain("curl -X POST https://api.example.com/v1/north/explore");
    expect(curl).toContain('-H "authorization: Bearer $LYRA_API_KEY"');
    expect(curl).toContain('"metricKeys":["gwp_month","loss_ratio"]');
    expect(curl).toContain('"grain":"month"');
    expect(curl).toContain('"period":"2026-08"');
  });

  it("never carries a real key, only the variable that stands for one", () => {
    const curl = curlFor("https://api.example.com", { metricKeys: ["a"], grain: "day", period: "2026-08-12" });
    expect(curl).not.toMatch(/Bearer\s+(?!\$)/);
  });
});

describe("headline", () => {
  it("says so when the snapshot layer itself could not be read", () => {
    expect(headline(null, l)).toBe("headline.denied");
  });

  it("points out an empty registry — there is nothing to query yet", () => {
    expect(headline([], l)).toBe("headline.empty");
  });

  it("counts the metrics on the bench once there are some", () => {
    expect(headline([{ key: "gwp_month" }, { key: "loss_ratio" }], l)).toBe("headline.ready:2");
  });
});
