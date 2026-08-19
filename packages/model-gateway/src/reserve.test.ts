import { describe, expect, it } from "vitest";
import { parseReserve, reserveMessages, reserveSchema } from "./reserve.js";

const RESERVE_CTX = {
  perilCode: "fire",
  causeCode: "electrical",
  complexity: "standard",
  excessMinor: 50_000,
  limits: { building: 1_000_000 },
  comparables: []
};

describe("parseReserve", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({
      recommendedMinor: 450_000,
      bandLowMinor: 400_000,
      bandHighMinor: 500_000,
      comparables: ["claim_1"]
    });
    expect(parseReserve("```json\n" + body + "\n```")).toEqual({
      recommendedMinor: 450_000,
      band: [400_000, 500_000],
      comparables: ["claim_1"],
      confidence: 100
    });
  });

  // Regression: see fraud.test.ts — valid JSON that is not an object used to throw.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseReserve(reply)).not.toThrow();
    expect(parseReserve(reply)).toEqual({ recommendedMinor: null, band: null, comparables: [], confidence: 0 });
  });

  const full = {
    recommendedMinor: 450_000,
    bandLowMinor: 400_000,
    bandHighMinor: 500_000,
    comparables: ["claim_1"]
  };

  it("rounds every minor amount to a whole cent", () => {
    expect(parseReserve(JSON.stringify({ ...full, recommendedMinor: 450_000.6, bandLowMinor: 399_999.4 }))).toEqual({
      recommendedMinor: 450_001,
      band: [399_999, 500_000],
      comparables: ["claim_1"],
      confidence: 100
    });
  });

  // A reserve of nothing is a real answer; a reserve of "450000" the string, or
  // of minus anything, is not — an amount that is not a non-negative number is
  // dropped rather than coerced, because a coerced reserve posts real money.
  it.each([
    ["a numeric string", "450000"],
    ["a negative amount", -5],
    ["a missing amount", undefined],
    ["null", null]
  ])("drops a recommendation given as %s", (_label, recommendedMinor) => {
    const reply = JSON.stringify({ ...full, recommendedMinor });
    expect(parseReserve(reply)).toMatchObject({ recommendedMinor: null, confidence: 75 });
  });

  // JSON has no Infinity literal, but `1e999` parses to one — and an infinite
  // reserve would round to Infinity and post as a real amount.
  it("drops a recommendation that is not finite", () => {
    const reply = '{"recommendedMinor":1e999,"bandLowMinor":400000,"bandHighMinor":500000,"comparables":[]}';
    expect(parseReserve(reply)).toMatchObject({ recommendedMinor: null, confidence: 75 });
  });

  it("keeps a zero recommendation — nil is a recommendation, not a missing one", () => {
    expect(parseReserve(JSON.stringify({ ...full, recommendedMinor: 0, bandLowMinor: 0 }))).toEqual({
      recommendedMinor: 0,
      band: [0, 500_000],
      comparables: ["claim_1"],
      confidence: 100
    });
  });

  // A rejected end is a missing field, so it costs a quarter of the confidence
  // too — asserting the band alone let a rejected end still be counted present.
  it.each([
    ["a low end that is not a number", { bandLowMinor: "400000" }, 75],
    ["a negative low end", { bandLowMinor: -1 }, 75],
    ["a missing low end", { bandLowMinor: undefined }, 75],
    ["a high end that is not a number", { bandHighMinor: "500000" }, 75],
    ["a negative high end", { bandHighMinor: -1 }, 75],
    ["a missing high end", { bandHighMinor: undefined }, 75],
    // Inverted: two valid ends that do not describe a band. Ordering is the
    // one thing the prompt asks for that the model can get wrong silently.
    // Both ends are real numbers, so nothing is missing — only unusable.
    ["an inverted band", { bandLowMinor: 500_000, bandHighMinor: 400_000 }, 100]
  ])("returns no band at all for %s, rather than half of one", (_label, patch, confidence) => {
    expect(parseReserve(JSON.stringify({ ...full, ...patch }))).toEqual({
      recommendedMinor: 450_000,
      band: null,
      comparables: ["claim_1"],
      confidence
    });
  });

  it("keeps a band whose ends are equal — a point estimate is a band of width zero", () => {
    const reply = JSON.stringify({ ...full, recommendedMinor: 400_000, bandLowMinor: 400_000, bandHighMinor: 400_000 });
    expect(parseReserve(reply).band).toEqual([400_000, 400_000]);
  });

  // Zero is a real end, not an absent one: a band of [0, 0] is "we expect to
  // pay nothing", which is a recommendation a reserve sweep has to be able to
  // state.
  it("keeps a band pinned at zero on both ends", () => {
    expect(
      parseReserve(JSON.stringify({ ...full, recommendedMinor: 0, bandLowMinor: 0, bandHighMinor: 0 }))
    ).toEqual({ recommendedMinor: 0, band: [0, 0], comparables: ["claim_1"], confidence: 100 });
  });

  // A zero low end with no high end is the one shape where a half-band could
  // slip through as [0, null] — nothing is "less than" a missing number.
  it("returns no band for a zero low end with no high end", () => {
    expect(parseReserve(JSON.stringify({ ...full, bandLowMinor: 0, bandHighMinor: undefined }))).toEqual({
      recommendedMinor: 450_000,
      band: null,
      comparables: ["claim_1"],
      confidence: 75
    });
  });

  it("keeps only the comparables that are non-blank strings, and never throws on the rest", () => {
    const reply = JSON.stringify({ ...full, comparables: ["claim_1", 42, "", "   ", null, "claim_2"] });
    expect(parseReserve(reply).comparables).toEqual(["claim_1", "claim_2"]);
  });

  it("counts a comparables array as present even when empty, but not a non-array", () => {
    expect(parseReserve(JSON.stringify({ ...full, comparables: [] })).confidence).toBe(100);
    expect(parseReserve(JSON.stringify({ ...full, comparables: "claim_1" }))).toMatchObject({
      comparables: [],
      confidence: 75
    });
  });

  it("scores confidence by how many of the four fields survived", () => {
    expect(parseReserve(JSON.stringify(full)).confidence).toBe(100);
    expect(parseReserve(JSON.stringify({ recommendedMinor: 450_000, comparables: [] })).confidence).toBe(50);
    expect(parseReserve(JSON.stringify({ recommendedMinor: 450_000 })).confidence).toBe(25);
    expect(parseReserve("{}").confidence).toBe(0);
  });
});

describe("reserveSchema", () => {
  it("requires the point estimate, both band ends and the comparables weighed", () => {
    expect(reserveSchema()).toEqual({
      name: "axis_claim_reserve_recommend",
      schema: {
        type: "object",
        properties: {
          recommendedMinor: { type: "integer" },
          bandLowMinor: { type: "integer" },
          bandHighMinor: { type: "integer" },
          comparables: { type: "array", items: { type: "string" } }
        },
        required: ["recommendedMinor", "bandLowMinor", "bandHighMinor", "comparables"]
      }
    });
  });
});

describe("reserveMessages", () => {
  const system = (): string => reserveMessages(RESERVE_CTX)[0]!.content;

  it("sends the rules as system and the claim as JSON, and nothing else", () => {
    const messages = reserveMessages(RESERVE_CTX);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe(JSON.stringify(RESERVE_CTX));
  });

  it("names every input the estimate may read, and how the comparables were picked", () => {
    for (const input of [
      /perilCode, causeCode/,
      /complexity, excessMinor, the limits given/,
      /same perilCode, closed within the last 24 months/
    ]) {
      expect(system()).toMatch(input);
    }
  });

  it("asks for a point estimate in minor units inside an ordered band", () => {
    expect(system()).toMatch(/recommendedMinor \(the point estimate, in minor currency units\)/);
    expect(system()).toMatch(/bandLowMinor <= recommendedMinor <= bandHighMinor/);
    expect(system()).toMatch(/comparables \(the ids, from the list given, of the comparable claims you actually weighed\)/);
  });

  it("bounds the recommendation by the limit and the excess, and forbids invented comparables", () => {
    expect(system()).toMatch(/Never recommend above the limit that matches the claim, and never below excessMinor/);
    expect(system()).toMatch(/returning an empty comparables array rather than inventing one/);
  });

  // CLAUDE.md #14: no industry nouns in a prompt — this one has to sell outside insurance.
  it("hard-codes no domain-pack noun", () => {
    for (const noun of [/\bpolicy\b/i, /\bpolicies\b/i, /\bpremium\b/i, /\binsurer\b/i, /\binsurance\b/i]) {
      expect(system()).not.toMatch(noun);
    }
  });
});
