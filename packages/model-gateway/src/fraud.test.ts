import { describe, expect, it } from "vitest";
import { fraudMessages, parseFraud } from "./fraud.js";

const FRAUD_CTX = {
  perilCode: "fire",
  causeCode: "electrical",
  incidentAt: 1_000,
  reportedAt: 2_000,
  amountMinor: 500_000,
  limits: { building: 1_000_000 },
  history: [],
  documents: []
};

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

describe("fraudMessages", () => {
  const system = (): string => fraudMessages(FRAUD_CTX)[0]!.content;

  // CLAUDE.md #14: no industry nouns in a prompt — this one has to sell outside insurance.
  it("hard-codes no domain-pack noun", () => {
    for (const noun of [/\bpolicy\b/i, /\bpolicies\b/i, /\bpremium\b/i, /\binsurer\b/i, /\binsurance\b/i]) {
      expect(system()).not.toMatch(noun);
    }
  });
});
