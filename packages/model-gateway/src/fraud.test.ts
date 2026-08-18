import { describe, expect, it } from "vitest";
import { fraudMessages, parseFraud } from "./fraud.js";
import { scrub } from "./scrub.js";

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

describe("fraudMessages", () => {
  // Same collision as ubi.test.ts: a Luhn-valid epoch-millisecond instant is
  // indistinguishable from a 13-digit PAN, and the gap between incidentAt and
  // reportedAt is the first thing this prompt asks the model to weigh.
  const LUHN_MS = 1_781_571_600_000; // 2026-06-16T01:00:00.000Z, Luhn-valid

  it("sends dates the model can read, even when an instant looks like a card number", () => {
    const messages = fraudMessages({ ...FRAUD_CTX, reportedAt: new Date(LUHN_MS).toISOString() });
    const { text, flags } = scrub(messages.at(-1)!.content);

    expect(flags).not.toContain("pii_card");
    expect(text).not.toContain("[[CARD_");
    expect(text).toContain(new Date(LUHN_MS).toISOString());
  });
});

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
