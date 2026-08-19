import { describe, expect, it } from "vitest";
import { fraudMessages, fraudSchema, parseFraud } from "./fraud.js";

const FRAUD_CTX = {
  perilCode: "fire",
  causeCode: "electrical",
  incidentAt: "1970-01-01T00:00:01.000Z",
  reportedAt: "1970-01-01T00:00:02.000Z",
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

describe("fraudSchema", () => {
  it("requires the score and its indicators, each indicator carrying its evidenceRef", () => {
    expect(fraudSchema()).toEqual({
      name: "axis_claim_fraud_score",
      schema: {
        type: "object",
        properties: {
          score: { type: "integer" },
          indicators: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                weight: { type: "number" },
                evidenceRef: { type: "string" }
              },
              required: ["code", "weight", "evidenceRef"]
            }
          }
        },
        required: ["score", "indicators"]
      }
    });
  });
});

describe("fraudMessages", () => {
  const system = (): string => fraudMessages(FRAUD_CTX)[0]!.content;

  it("sends the rules as system and the claim as JSON, and nothing else", () => {
    const messages = fraudMessages(FRAUD_CTX);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe(JSON.stringify(FRAUD_CTX));
  });

  it("names every signal the score may read", () => {
    for (const signal of [
      /perilCode and causeCode/,
      /the gap between incidentAt and reportedAt/,
      /amountMinor against the limits given/,
      /prior claim history/,
      /document extraction results/
    ]) {
      expect(system()).toMatch(signal);
    }
  });

  it("fixes the score scale and the shape of an indicator", () => {
    expect(system()).toMatch(/score \(0-100, how strongly the claim looks referable/);
    expect(system()).toMatch(/short slug naming the signal/);
    expect(system()).toMatch(/evidenceRef, the specific/);
    expect(system()).toMatch(/a prior claim id, document id, or field name/);
  });

  // parseFraud drops an indicator with no evidenceRef, so the prompt has to ask
  // for what the parser will keep — otherwise every reply is silently thinned.
  it("refuses an unevidenced indicator and an unexplained score", () => {
    expect(system()).toMatch(/never invent one you cannot point to evidence for/);
    expect(system()).toMatch(/an unexplained score is not a score/);
  });

  // CLAUDE.md #14: no industry nouns in a prompt — this one has to sell outside insurance.
  it("hard-codes no domain-pack noun", () => {
    for (const noun of [/\bpolicy\b/i, /\bpolicies\b/i, /\bpremium\b/i, /\binsurer\b/i, /\binsurance\b/i]) {
      expect(system()).not.toMatch(noun);
    }
  });
});
