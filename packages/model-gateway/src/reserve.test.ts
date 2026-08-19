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
