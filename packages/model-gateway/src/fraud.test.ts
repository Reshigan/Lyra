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

  it("keeps a well-formed reply whole, and counts both fields towards confidence", () => {
    expect(parseFraud(JSON.stringify({ score: 72, indicators: [evidenced] }))).toEqual({
      score: 72,
      indicators: [evidenced],
      droppedIndicatorCount: 0,
      confidence: 100
    });
  });

  // Anything that is not an object cannot carry code/weight/evidenceRef, so it
  // was never a candidate — dropping it must not inflate droppedIndicatorCount,
  // and reading `.code` off null must not throw.
  it("ignores array entries that are not objects rather than counting them as dropped", () => {
    expect(parseFraud(JSON.stringify({ score: 30, indicators: [evidenced, null, "late_report", 7, []] }))).toEqual({
      score: 30,
      indicators: [evidenced],
      droppedIndicatorCount: 1, // the [] — an object, but with no fields
      confidence: 100
    });
  });

  it.each([
    ["a non-string code", { ...evidenced, code: 42 }],
    ["a blank code", { ...evidenced, code: "   " }],
    ["a non-number weight", { ...evidenced, weight: "40" }],
    ["a non-string evidenceRef", { ...evidenced, evidenceRef: 7 }],
    ["a blank evidenceRef", { ...evidenced, evidenceRef: "   " }]
  ])("drops an indicator with %s, and scores nothing once none survive", (_label, indicator) => {
    expect(parseFraud(JSON.stringify({ score: 88, indicators: [indicator] }))).toEqual({
      score: 0,
      indicators: [],
      droppedIndicatorCount: 1,
      confidence: 100
    });
  });

  // JSON has no NaN/Infinity literal, but `1e999` parses to Infinity — an
  // unbounded weight would otherwise ride into the referral as a real one.
  it("drops an indicator whose weight is not finite", () => {
    const reply = '{"score":88,"indicators":[{"code":"late_report","weight":1e999,"evidenceRef":"reportedAt_0"}]}';
    expect(parseFraud(reply)).toEqual({ score: 0, indicators: [], droppedIndicatorCount: 1, confidence: 100 });
  });

  it("keeps a zero and a negative weight — only the evidence is mandatory", () => {
    const indicators = [
      { code: "a", weight: 0, evidenceRef: "claim_1" },
      { code: "b", weight: -15, evidenceRef: "doc_1" }
    ];
    expect(parseFraud(JSON.stringify({ score: 60, indicators }))).toEqual({
      score: 60,
      indicators,
      droppedIndicatorCount: 0,
      confidence: 100
    });
  });

  // "Never return a score above 0 with an empty indicators array" is enforced
  // here, not only asked for in the prompt.
  it("zeroes a score no surviving indicator explains", () => {
    expect(parseFraud(JSON.stringify({ score: 91, indicators: [] }))).toEqual({
      score: 0,
      indicators: [],
      droppedIndicatorCount: 0,
      confidence: 100
    });
  });

  it.each([
    ["clamps above 100", 140, 100],
    ["clamps below 0", -20, 0],
    ["rounds a fractional score", 72.6, 73],
    ["keeps the boundary", 100, 100]
  ])("%s", (_label, raw, expected) => {
    expect(parseFraud(JSON.stringify({ score: raw, indicators: [evidenced] })).score).toBe(expected);
  });

  it("scores nothing for a string score, and says so in the confidence", () => {
    expect(parseFraud('{"score":"72","indicators":[{"code":"a","weight":1,"evidenceRef":"r"}]}')).toEqual({
      score: 0,
      indicators: [{ code: "a", weight: 1, evidenceRef: "r" }],
      droppedIndicatorCount: 0,
      confidence: 50
    });
  });

  // `1e999` parses to Infinity: a number by typeof, so the field counts as
  // present and confidence stays 100 — but Math.round(Infinity) is Infinity,
  // never a score, so the clamp has to reject it on finiteness, not on range.
  it("scores nothing for an infinite score", () => {
    expect(parseFraud('{"score":1e999,"indicators":[{"code":"a","weight":1,"evidenceRef":"r"}]}')).toEqual({
      score: 0,
      indicators: [{ code: "a", weight: 1, evidenceRef: "r" }],
      droppedIndicatorCount: 0,
      confidence: 100
    });
  });

  it("halves confidence when indicators is not an array at all", () => {
    expect(parseFraud(JSON.stringify({ score: 72, indicators: "late_report" }))).toEqual({
      score: 0,
      indicators: [],
      droppedIndicatorCount: 0,
      confidence: 50
    });
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
