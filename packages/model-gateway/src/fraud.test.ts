import { describe, expect, it } from "vitest";
import { parseFraud } from "./fraud.js";

const evidenced = { code: "late_report", weight: 40, evidenceRef: "reportedAt_0" };

describe("parseFraud", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({ score: 72, indicators: [evidenced] });
    const r = parseFraud("```json\n" + body + "\n```");
    expect(r.score).toBe(72);
    expect(r.indicators).toEqual([evidenced]);
  });

  // Regression: `JSON.parse` returns null, 42 or "a string" for replies that are
  // valid JSON but not objects, and the first property read on null threw a
  // TypeError straight through the never-throws contract.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseFraud(reply)).not.toThrow();
    expect(parseFraud(reply)).toEqual({ score: 0, indicators: [], droppedIndicatorCount: 0, confidence: 0 });
  });
});
