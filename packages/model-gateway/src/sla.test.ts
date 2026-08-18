import { describe, expect, it } from "vitest";
import { parseSla } from "./sla.js";

const driver = { feature: "queueDepth", detail: "queue is 3x the owner's throughput", evidenceRef: "queueDepth" };

describe("parseSla", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({ breachProbability: 82, driver });
    expect(parseSla("```json\n" + body + "\n```")).toEqual({ breachProbability: 82, driver, confidence: 100 });
  });

  // Regression: see fraud.test.ts — valid JSON that is not an object used to throw.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseSla(reply)).not.toThrow();
    expect(parseSla(reply)).toEqual({ breachProbability: 0, driver: null, confidence: 0 });
  });
});
