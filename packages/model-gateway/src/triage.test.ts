import { describe, expect, it } from "vitest";
import { parseTriage } from "./triage.js";

describe("parseTriage", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({ perilCode: "fire", causeCode: "negligence", complexity: "complex" });
    expect(parseTriage("```json\n" + body + "\n```")).toEqual({
      perilCode: "fire",
      causeCode: "negligence",
      complexity: "complex",
      confidence: 100
    });
  });

  // Regression: see fraud.test.ts — valid JSON that is not an object used to throw.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseTriage(reply)).not.toThrow();
    expect(parseTriage(reply)).toEqual({ perilCode: null, causeCode: null, complexity: null, confidence: 0 });
  });
});
