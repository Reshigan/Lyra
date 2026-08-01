import { describe, expect, it } from "vitest";
import { clusterSignals, momentumScore, type RawSignal } from "./momentum.js";

describe("momentumScore", () => {
  it("scores higher volume+growth+novelty higher than lower ones", () => {
    const low = momentumScore({ volume: 10, growth: 1, novelty: 0.2 });
    const mid = momentumScore({ volume: 20, growth: 1.5, novelty: 0.5 });
    const high = momentumScore({ volume: 30, growth: 3, novelty: 1 });
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("clamps to the 0-100 scale the column expects", () => {
    expect(momentumScore({ volume: 1000, growth: 10, novelty: 1 })).toBe(100);
    expect(momentumScore({ volume: 0, growth: 0, novelty: 0 })).toBe(0);
  });

  it("treats negative growth (a cluster that shrank) as zero, not a negative score", () => {
    expect(momentumScore({ volume: 50, growth: -2, novelty: 1 })).toBe(0);
  });
});

describe("clusterSignals", () => {
  const now = 1000;
  const windowMs = 100; // cutoff at 900, prior window [800, 900)

  const sig = (id: string, category: string, sourceRef: string, weight: number, observedAt: number): RawSignal => ({
    id,
    category,
    sourceRef,
    weight,
    observedAt
  });

  it("groups by category and ranks the busier, faster-growing, more novel one first", () => {
    const signals: RawSignal[] = [
      // "search": tripled in weight since the prior window, three distinct sources.
      sig("s1", "search", "ref-a", 10, 950),
      sig("s2", "search", "ref-b", 10, 960),
      sig("s3", "search", "ref-c", 10, 970),
      sig("s0", "search", "ref-prior", 10, 850),
      // "reviews": flat weight, same single source repeated.
      sig("r1", "reviews", "ref-r", 5, 950),
      sig("r0", "reviews", "ref-r", 5, 850)
    ];

    const clusters = clusterSignals(signals, now, windowMs);

    expect(clusters.map((c) => c.category)).toEqual(["search", "reviews"]);
    expect(clusters[0]!.momentum).toBeGreaterThan(clusters[1]!.momentum);
    expect(clusters[0]!.signalIds).toEqual(["s1", "s2", "s3", "s0"]);
  });

  it("scores a repeated single source lower than an equally busy but distinct-source cluster (novelty)", () => {
    const distinct: RawSignal[] = [
      sig("a1", "distinct", "ref-1", 10, 950),
      sig("a2", "distinct", "ref-2", 10, 960),
      sig("a3", "distinct", "ref-3", 10, 970),
      sig("a0", "distinct", "ref-prior", 10, 850)
    ];
    const repeat: RawSignal[] = [
      sig("b1", "repeat", "same-ref", 10, 950),
      sig("b2", "repeat", "same-ref", 10, 960),
      sig("b3", "repeat", "same-ref", 10, 970),
      sig("b0", "repeat", "ref-prior", 10, 850)
    ];

    const [distinctCluster] = clusterSignals(distinct, now, windowMs);
    const [repeatCluster] = clusterSignals(repeat, now, windowMs);

    expect(distinctCluster!.momentum).toBeGreaterThan(repeatCluster!.momentum);
  });

  it("returns no cluster for an empty signal set", () => {
    expect(clusterSignals([], now, windowMs)).toEqual([]);
  });
});
