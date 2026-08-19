import { describe, expect, it } from "vitest";
import {
  assertWhitespaceTransition,
  canWhitespaceTransition,
  computeWhitespaceCandidates,
  isWhitespaceState,
  WHITESPACE_STATES,
  WHITESPACE_TRANSITIONS
} from "./whitespace.js";
import { DEFAULT_K_FLOOR } from "./k-anonymity.js";
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

  it("states the whole candidate, not just its name", () => {
    const quotes: RawSignal[] = [
      ...Array.from({ length: 8 }, (_, i) => quote(`t${i}`, "travel", 950)),
      quote("travel-prior", "travel", 850),
      ...Array.from({ length: 8 }, (_, i) => quote(`m${i}`, "motor", 950)),
      ...Array.from({ length: 8 }, (_, i) => quote(`mp${i}`, "motor", 850))
    ];
    const coverage = [
      { category: "travel", policyCount: 2 },
      { category: "motor", policyCount: 500 }
    ];
    expect(computeWhitespaceCandidates(quotes, coverage, now, windowMs, 5)).toEqual([
      // cellCount is the whole evidence cell — both windows, not just the recent one.
      { category: "travel", momentum: expect.any(Number), coverage: 2, cellCount: 9, visible: true }
    ]);
  });

  // Strictly above and strictly below: a category exactly at the book's average
  // on either axis is the average, not whitespace, and flagging it would make
  // every sweep on a two-category book return both of them.
  it("excludes a category that only ties the average", () => {
    const quotes: RawSignal[] = [
      // "a" and "b" identical in every respect: both sit exactly on both averages.
      ...Array.from({ length: 8 }, (_, i) => quote(`a${i}`, "a", 950)),
      quote("a-prior", "a", 850),
      ...Array.from({ length: 8 }, (_, i) => quote(`b${i}`, "b", 950)),
      quote("b-prior", "b", 850)
    ];
    const coverage = [
      { category: "a", policyCount: 5 },
      { category: "b", policyCount: 5 }
    ];
    expect(computeWhitespaceCandidates(quotes, coverage, now, windowMs, 5)).toEqual([]);
  });

  // A category the book covers but nobody quotes has momentum 0, and a category
  // with demand and no row in the coverage export has coverage 0 — the defaults
  // are what let one export be sparser than the other.
  it("reads a missing side as zero rather than dropping the category", () => {
    const quotes: RawSignal[] = [
      ...Array.from({ length: 20 }, (_, i) => quote(`p${i}`, "pet", 950)),
      quote("pet-prior", "pet", 850)
    ];
    // "legacy" is on the book and never quoted; "pet" is quoted and not on the book.
    const out = computeWhitespaceCandidates(quotes, [{ category: "legacy", policyCount: 400 }], now, windowMs, 5);
    expect(out).toEqual([{ category: "pet", momentum: expect.any(Number), coverage: 0, cellCount: 21, visible: true }]);
  });

  // The route renders these in order and the top row is the one an analyst acts
  // on, so the ordering is behaviour: hottest demand first.
  it("sorts candidates by momentum, hottest first", () => {
    const quotes: RawSignal[] = [
      // "hot" grows harder than "warm"; "cold" is the unquoted, deep-book control
      // that drags both averages down far enough for two candidates to clear them.
      ...Array.from({ length: 30 }, (_, i) => quote(`h${i}`, "hot", 950)),
      quote("h-prior", "hot", 850),
      ...Array.from({ length: 20 }, (_, i) => quote(`w${i}`, "warm", 950)),
      ...Array.from({ length: 7 }, (_, i) => quote(`wp${i}`, "warm", 850))
    ];
    const coverage = [
      { category: "hot", policyCount: 0 },
      { category: "warm", policyCount: 0 },
      { category: "cold", policyCount: 900 }
    ];
    const out = computeWhitespaceCandidates(quotes, coverage, now, windowMs, 5);
    expect(out.map((c) => c.category)).toEqual(["hot", "warm"]);
    expect(out[0]!.momentum).toBeGreaterThan(out[1]!.momentum);
  });

  // Both thresholds are means over *every* category the two exports mention,
  // including the ones with no demand at all — a book-wide average, not an
  // average of the interesting rows.
  it("measures demand against the mean of the whole book, not against zero", () => {
    const quotes: RawSignal[] = [
      // momentum 40 and 20: volume alone, one window, every ref distinct.
      ...Array.from({ length: 40 }, (_, i) => quote(`h${i}`, "high", 950)),
      ...Array.from({ length: 20 }, (_, i) => quote(`l${i}`, "low", 950))
    ];
    const coverage = [
      { category: "high", policyCount: 0 },
      { category: "low", policyCount: 0 },
      // Quoted by nobody, so momentum 0 — and it still counts in the mean,
      // which is what puts "low" exactly on the line at 20.
      { category: "bulk", policyCount: 300 }
    ];
    expect(computeWhitespaceCandidates(quotes, coverage, now, windowMs, 5)).toEqual([
      { category: "high", momentum: 40, coverage: 0, cellCount: 40, visible: true }
    ]);
  });

  // The coverage side of the same mean: hot demand on a category the book
  // already carries at or above its average depth is not whitespace, however
  // hot it is.
  it("excludes hot demand whose coverage only meets the book's average depth", () => {
    const quotes: RawSignal[] = [
      ...Array.from({ length: 40 }, (_, i) => quote(`d${i}`, "deep", 950)),
      ...Array.from({ length: 20 }, (_, i) => quote(`a${i}`, "a", 950)),
      ...Array.from({ length: 20 }, (_, i) => quote(`b${i}`, "b", 950))
    ];
    // Every category carries 300, so the average depth is 300 and "deep" sits
    // exactly on it despite being the only category above the demand average.
    const coverage = ["deep", "a", "b"].map((category) => ({ category, policyCount: 300 }));
    expect(computeWhitespaceCandidates(quotes, coverage, now, windowMs, 5)).toEqual([]);
  });

  it("defaults to the shared k-anonymity floor when no floor is given", () => {
    const quotes: RawSignal[] = [
      ...Array.from({ length: DEFAULT_K_FLOOR - 1 }, (_, i) => quote(`n${i}`, "niche", 950)),
      ...control
    ];
    const coverage = [{ category: "niche", policyCount: 0 }, controlCoverage];
    expect(computeWhitespaceCandidates(quotes, coverage, now, windowMs)[0]!.visible).toBe(false);
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
