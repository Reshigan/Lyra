import { describe, expect, it } from "vitest";
import { headlineFor, humanKey, readAssumptions, unitOf } from "./north-whatif";

// Scenario keys come out of the model, not out of a registry, so the unit and
// the label are both read off the name. These are the shapes the seed writes
// (packages/core/src/seed.ts north_scenarios).

describe("unitOf", () => {
  it("reads money, basis points, parts per million and milliseconds off the suffix", () => {
    expect(unitOf("gwpDeltaMinor")).toBe("money");
    expect(unitOf("volumeUpliftBps")).toBe("bps");
    expect(unitOf("channelSharePpm")).toBe("ppm");
    expect(unitOf("quoteLatencyBudgetMs")).toBe("ms");
  });

  it("treats an unsuffixed key as a plain count rather than guessing", () => {
    expect(unitOf("horizonMonths")).toBe("count");
    expect(unitOf("policiesDelta")).toBe("count");
  });
});

describe("humanKey", () => {
  it("drops the unit suffix — the value beside it is already in that unit", () => {
    expect(humanKey("quoteLatencyP95DeltaMs")).toBe("Quote latency P95 delta");
  });

  it("keeps an acronym as an acronym, at the front or in the middle", () => {
    expect(humanKey("gwpDeltaMinor")).toBe("GWP delta");
    expect(humanKey("currentSlaSeconds")).toBe("Current SLA seconds");
  });

  it("leaves a key it cannot split alone", () => {
    expect(humanKey("line")).toBe("Line");
  });
});

describe("headlineFor", () => {
  it("narrates the open scenario's own question rather than a generic title", () => {
    expect(headlineFor({ question: "What if we raise premiums 5%?" }, (key) => key)).toBe(
      "What if we raise premiums 5%?"
    );
  });

  it("falls back to the page title when nothing is open yet", () => {
    expect(headlineFor(null, (key) => key)).toBe("title");
  });
});

describe("readAssumptions", () => {
  it("takes name: value a line at a time, numbers as numbers", () => {
    expect(readAssumptions("horizonMonths: 6\ncurrency: AED")).toEqual({ horizonMonths: 6, currency: "AED" });
  });

  it("ignores blank lines and the spacing somebody actually types", () => {
    expect(readAssumptions("  line : motor \n\n  volumeUpliftBps:1200")).toEqual({
      line: "motor",
      volumeUpliftBps: 1200
    });
  });

  it("refuses a line with no name rather than dropping an assumption quietly", () => {
    expect(readAssumptions("horizonMonths: 6\njust some prose")).toBeNull();
    expect(readAssumptions(": 6")).toBeNull();
  });

  it("keeps an empty value as an empty string, not as zero", () => {
    expect(readAssumptions("note:")).toEqual({ note: "" });
  });
});
