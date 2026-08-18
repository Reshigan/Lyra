import { describe, expect, it } from "vitest";
import { MAX_REPRICE_PPM, parseUbi, ubiMessages, ubiSchema, type UbiContext } from "./ubi.js";

const KM = "telematics:obd:km";
const BRAKE = "telematics:obd:harsh_brake_events";

/** One well-formed, fully evidenced factor. */
const evidenced = (evidenceRef = KM): Record<string, unknown> => ({
  code: "distance_over_baseline",
  weight: 1,
  evidenceRef
});

const reply = (body: Record<string, unknown>): string => JSON.stringify(body);

const ctx: UbiContext = {
  series: [
    { source: KM, total: 18_400, pointCount: 92, baseline: 16_000 },
    { source: BRAKE, total: 41, pointCount: 41, baseline: 30 }
  ],
  windowStart: 1_700_000_000_000,
  windowEnd: 1_707_776_000_000
};

describe("parseUbi", () => {
  it("keeps a signed delta and every evidenced factor", () => {
    const r = parseUbi(
      reply({
        premiumDeltaPpm: 48_000,
        confidence: 0.82,
        factors: [evidenced(KM), { code: "harsh_braking_rate", weight: 0.4, evidenceRef: BRAKE }]
      })
    );
    expect(r.premiumDeltaPpm).toBe(48_000);
    expect(r.factors.map((f) => f.evidenceRef)).toEqual([KM, BRAKE]);
    expect(r.droppedFactorCount).toBe(0);
    expect(r.confidence).toBe(0.82);
  });

  it("keeps a negative delta — telemetry better than the baseline lowers the price", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: -64_000, factors: [evidenced()] })).premiumDeltaPpm).toBe(-64_000);
  });

  it("strips a ```json fence", () => {
    const body = reply({ premiumDeltaPpm: 36_000, factors: [evidenced()] });
    expect(parseUbi("```json\n" + body + "\n```").premiumDeltaPpm).toBe(36_000);
  });

  it("strips a bare fence", () => {
    const body = reply({ premiumDeltaPpm: -12_000, factors: [evidenced()] });
    expect(parseUbi("```\n" + body + "\n```").premiumDeltaPpm).toBe(-12_000);
  });

  it("drops a factor with a missing, empty, whitespace or non-string evidenceRef, and counts each drop", () => {
    const r = parseUbi(
      reply({
        premiumDeltaPpm: 55_000,
        factors: [
          evidenced(),
          { code: "no_ref", weight: 0.2 },
          { code: "empty_ref", weight: 0.2, evidenceRef: "" },
          { code: "blank_ref", weight: 0.2, evidenceRef: "   " },
          { code: "numeric_ref", weight: 0.2, evidenceRef: 7 }
        ]
      })
    );
    expect(r.factors).toEqual([{ code: "distance_over_baseline", weight: 1, evidenceRef: KM }]);
    expect(r.droppedFactorCount).toBe(4);
    // One evidenced factor survived, so the adjustment is still explainable.
    expect(r.premiumDeltaPpm).toBe(55_000);
  });

  it("forces the delta to 0 when every factor was dropped", () => {
    const r = parseUbi(reply({ premiumDeltaPpm: 90_000, factors: [{ code: "vibes", weight: 1, evidenceRef: "" }] }));
    expect(r.premiumDeltaPpm).toBe(0);
    expect(r.droppedFactorCount).toBe(1);
  });

  it("forces the delta to 0 when factors is empty", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: 90_000, factors: [] })).premiumDeltaPpm).toBe(0);
  });

  it("forces the delta to 0 when factors is absent entirely", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: -90_000 })).premiumDeltaPpm).toBe(0);
  });

  it("clamps a runaway increase", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: 9_000_000, factors: [evidenced()] })).premiumDeltaPpm).toBe(
      MAX_REPRICE_PPM
    );
  });

  it("clamps a runaway decrease", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: -9_000_000, factors: [evidenced()] })).premiumDeltaPpm).toBe(
      -MAX_REPRICE_PPM
    );
  });

  it("rounds a fractional ppm to a whole one", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: 1234.6, factors: [evidenced()] })).premiumDeltaPpm).toBe(1235);
  });

  it("returns a zero delta for garbage instead of throwing", () => {
    for (const bad of [
      "the driving looks about 5% worse than the book, maybe raise it?",
      '{"premiumDeltaPpm":',
      "null",
      "42",
      '"a string"',
      "[]",
      ""
    ]) {
      const r = parseUbi(bad);
      expect(r.premiumDeltaPpm).toBe(0);
      expect(r.factors).toEqual([]);
      expect(r.droppedFactorCount).toBe(0);
      expect(r.confidence).toBe(0);
    }
  });

  it("ignores non-finite and non-numeric deltas", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: "48000", factors: [evidenced()] })).premiumDeltaPpm).toBe(0);
    expect(parseUbi('{"premiumDeltaPpm":1e999,"factors":[]}').premiumDeltaPpm).toBe(0);
  });

  it("clamps confidence into 0..1 and defaults it to 0", () => {
    expect(parseUbi(reply({ premiumDeltaPpm: 0, factors: [], confidence: 4 })).confidence).toBe(1);
    expect(parseUbi(reply({ premiumDeltaPpm: 0, factors: [], confidence: -2 })).confidence).toBe(0);
    expect(parseUbi(reply({ premiumDeltaPpm: 0, factors: [], confidence: "high" })).confidence).toBe(0);
    expect(parseUbi(reply({ premiumDeltaPpm: 0, factors: [] })).confidence).toBe(0);
  });

  // This is a *purity* assertion, not a fairness gate, and the difference matters.
  // parseUbi takes one string and reads six named fields off it; it has no access to
  // the subject, so it cannot price a protected attribute however hard it tried. The
  // real exclusion is upstream: `UbiContext` carries only series, totals, baselines
  // and a window, so no protected attribute or proxy is ever sent (docs/12 §4,
  // "pricing-adjacent models exclude protected attributes" — enforced at the input
  // boundary, which is the only place "exclude" is enforceable). What this test buys
  // is a regression guard: a future parser that started reading `postcodeBand` off the
  // reply would fail here. It cannot measure model fairness, so it does not live in
  // evals/ — a gate that can only ever report 0 is not evidence of anything.
  it("never reads a protected proxy: two replies differing only in one parse identically", () => {
    const body = (postcodeBand: string, driverAgeBand: string): string =>
      reply({
        premiumDeltaPpm: 42_000,
        confidence: 0.7,
        postcodeBand,
        driverAgeBand,
        factors: [evidenced()]
      });
    const bandA = parseUbi(body("A", "18-24"));
    expect(bandA).toEqual(parseUbi(body("F", "55-64")));
    // Pinned, not just equal: two identically-zeroed results are also "equal", and
    // would pass a bare toEqual while proving nothing about the proxy.
    expect(bandA.premiumDeltaPpm).toBe(42_000);
    expect(bandA.factors).toHaveLength(1);
  });

  it("drops a factor whose code or weight is unusable", () => {
    const r = parseUbi(
      reply({
        premiumDeltaPpm: 10_000,
        factors: [evidenced(), { code: "", weight: 1, evidenceRef: KM }, { code: "x", weight: "heavy", evidenceRef: KM }]
      })
    );
    expect(r.factors).toHaveLength(1);
    expect(r.droppedFactorCount).toBe(2);
  });
});

describe("ubiSchema", () => {
  it("requires the delta and its factors, each factor carrying its evidenceRef", () => {
    const schema = ubiSchema().schema as {
      required: string[];
      properties: { factors: { items: { required: string[] } } };
    };
    expect(schema.required).toContain("premiumDeltaPpm");
    expect(schema.required).toContain("factors");
    expect(schema.properties.factors.items.required).toEqual(["code", "weight", "evidenceRef"]);
  });
});

describe("ubiMessages", () => {
  const system = (c: UbiContext = ctx): string => ubiMessages(c)[0]!.content;

  it("carries every series key, its total and its baseline", () => {
    const user = ubiMessages(ctx)[1]!.content;
    for (const s of ctx.series) {
      expect(user).toContain(s.source);
      expect(user).toContain(String(s.total));
      expect(user).toContain(String(s.baseline));
    }
  });

  it("demands an evidenceRef naming the series for every factor", () => {
    expect(system()).toContain("evidenceRef");
    expect(system()).toContain("series key");
  });

  it("names the clamp so the model is not invited to exceed it", () => {
    expect(system()).toContain(String(MAX_REPRICE_PPM));
  });

  it("refuses an unexplained adjustment", () => {
    expect(system()).toMatch(/never return a non-zero/i);
  });

  // CLAUDE.md #14: no industry nouns in a prompt — this one has to sell outside insurance.
  it("hard-codes no domain-pack noun", () => {
    for (const noun of [/\bpolicy\b/i, /\bpolicies\b/i, /\bpremium\b/i, /\binsurer\b/i, /\binsurance\b/i]) {
      expect(system()).not.toMatch(noun);
    }
  });
});
