import { describe, expect, it } from "vitest";
import {
  assertWhitespaceTransition,
  canWhitespaceTransition,
  computeWhitespaceCandidates,
  isWhitespaceState,
  WHITESPACE_STATES,
  WHITESPACE_TRANSITIONS
} from "./whitespace.js";
import type { RawSignal } from "./momentum.js";

// docs/modules/scout.md §2.1/§8 — cold-start whitespace radar: from a real
// quote export plus this tenant's own policy coverage, flag a category with
// above-average demand momentum and below-average coverage, and gate the
// output through the same k-anonity floor panel-bench uses (§2.5).

describe("computeWhitespaceCandidates", () => {
  const now = 1000;
  const windowMs = 100; // cutoff 900, prior window [800, 900)

  const quote = (id: string, category: string, observedAt: number): RawSignal => ({
    id,
    category,
    sourceRef: id,
    weight: 1,
    observedAt
  });

  it("flags a busy, growing category with few policies on the book and excludes a well-covered one", () => {
    // "travel": 8 fresh quotes this window, only 1 the prior window (growing), no
    // two quotes from the same ref (novel) - and just 2 policies on the book.
    const quotes: RawSignal[] = [
      ...Array.from({ length: 8 }, (_, i) => quote(`travel-${i}`, "travel", 950)),
      quote("travel-prior", "travel", 850),
      // "motor": same volume this window, flat vs. prior (no growth) - and a
      // deep book of policies already.
      ...Array.from({ length: 8 }, (_, i) => quote(`motor-${i}`, "motor", 950)),
      ...Array.from({ length: 8 }, (_, i) => quote(`motor-prior-${i}`, "motor", 850))
    ];
    const coverage = [
      { category: "travel", policyCount: 2 },
      { category: "motor", policyCount: 500 }
    ];

    const out = computeWhitespaceCandidates(quotes, coverage, now, windowMs);

    const categories = out.map((c) => c.category);
    expect(categories).toContain("travel");
    expect(categories).not.toContain("motor");
  });

  it("returns no candidates for an empty quote export", () => {
    expect(computeWhitespaceCandidates([], [], now, windowMs)).toEqual([]);
  });

  // A flat, well-covered control category, present in both k-anonymity cases so
  // "above/below average" has a real peer to compare against - a single
  // category is always exactly average, so it could never flag as whitespace.
  // Every quote replays the same source ref (one requester re-quoting), so
  // novelty - and with it momentum - stays low despite the raw volume.
  const control: RawSignal[] = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i}`,
    category: "control",
    sourceRef: "dup",
    weight: 1,
    observedAt: 950
  }));
  const controlCoverage = { category: "control", policyCount: 500 };

  it("suppresses a candidate whose evidence cell falls below the k-anonymity floor", () => {
    // Only 3 quotes total behind "niche" - real demand, but too thin a cell to
    // publish without naming who asked.
    const quotes: RawSignal[] = [
      quote("n1", "niche", 950),
      quote("n2", "niche", 960),
      quote("n3", "niche", 970),
      ...control
    ];
    const coverage = [{ category: "niche", policyCount: 0 }, controlCoverage];

    const out = computeWhitespaceCandidates(quotes, coverage, now, windowMs, 20);

    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("niche");
    expect(out[0]!.visible).toBe(false);
  });

  it("passes a candidate whose evidence cell meets the floor", () => {
    const quotes: RawSignal[] = [
      ...Array.from({ length: 20 }, (_, i) => quote(`h${i}`, "health", 950)),
      ...control
    ];
    const coverage = [{ category: "health", policyCount: 1 }, controlCoverage];

    const out = computeWhitespaceCandidates(quotes, coverage, now, windowMs, 20);

    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("health");
    expect(out[0]!.visible).toBe(true);
  });
});

describe("whitespace state machine", () => {
  it("promotes a fresh candidate", () => {
    expect(canWhitespaceTransition("candidate", "validated")).toBe(true);
    expect(() => assertWhitespaceTransition("candidate", "validated")).not.toThrow();
  });

  it("refuses a second promotion of the same candidate", () => {
    expect(canWhitespaceTransition("validated", "validated")).toBe(false);
    // 409 with the reason in `detail` — `conflict()`'s own message is "Conflict".
    expect(() => assertWhitespaceTransition("validated", "validated")).toThrow(
      expect.objectContaining({ status: 409, detail: "whitespace cannot move from validated to validated" })
    );
  });

  it("refuses promoting a parked candidate without reopening it first", () => {
    expect(() => assertWhitespaceTransition("parked", "validated")).toThrow();
    expect(canWhitespaceTransition("parked", "candidate")).toBe(true);
  });

  it("refuses a status no vocabulary claims", () => {
    expect(isWhitespaceState("promoted")).toBe(false);
    expect(() => assertWhitespaceTransition("promoted", "validated")).toThrow(
      expect.objectContaining({ status: 409, detail: "whitespace cannot move from promoted to validated" })
    );
  });

  it("knows every documented status and nothing else", () => {
    expect([...WHITESPACE_STATES]).toEqual(["candidate", "validating", "validated", "parked"]);
    for (const s of WHITESPACE_STATES) expect(isWhitespaceState(s)).toBe(true);
  });

  // Every allowed hop, spelled out: a transition list quietly emptied is a
  // route that starts answering 409 with nothing else failing.
  it("allows exactly the documented hops", () => {
    expect(WHITESPACE_TRANSITIONS).toEqual({
      candidate: ["validating", "validated", "parked"],
      validating: ["validated", "parked", "candidate"],
      validated: ["parked"],
      parked: ["candidate"]
    });
  });

  it("only ever targets a real state", () => {
    for (const s of WHITESPACE_STATES) {
      for (const t of WHITESPACE_TRANSITIONS[s]) expect(isWhitespaceState(t)).toBe(true);
    }
  });
});
