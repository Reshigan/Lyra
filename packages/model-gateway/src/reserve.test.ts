import { describe, expect, it } from "vitest";
import { parseReserve } from "./reserve.js";

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
