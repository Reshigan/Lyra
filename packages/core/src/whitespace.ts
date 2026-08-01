// docs/modules/scout.md §2.1/§8 — the cold-start whitespace radar: turn a real
// quote export into evidenced whitespace candidates instead of the 7
// hand-written rows in seed/scout.ts (those stay a fixed demo narrative; this
// is what a live tenant's own data would actually produce).
//
// Reuses clusterSignals/momentumScore (momentum.ts) for the demand side and
// checkKAnonymity (k-anonymity.ts) for the suppression gate, exactly as
// panel-bench does in apps/api/src/resources.ts - no reimplementation of
// either.

import { clusterSignals, type RawSignal } from "./momentum.js";
import { checkKAnonymity, DEFAULT_K_FLOOR } from "./k-anonymity.js";

/** How many of this tenant's own policies already sit in a category - the
 *  "coverage" a whitespace candidate has to be thin against. Source: a count
 *  over axis_policies grouped by core_products.line (see seed/axis.ts for the
 *  shape of a real policy row). */
export interface CoverageInput {
  readonly category: string;
  readonly policyCount: number;
}

export interface WhitespaceCandidate {
  readonly category: string;
  readonly momentum: number;
  readonly coverage: number;
  /** Evidence count backing this category - the cell checkKAnonymity gates on. */
  readonly cellCount: number;
  readonly visible: boolean;
}

/**
 * A category is a whitespace candidate when demand is moving faster than this
 * tenant's book on average, and the book's coverage of it is thinner than
 * average - real signal, thin footprint. `visible` is false when the evidence
 * behind it (`cellCount`, the quote count clusterSignals grouped) is below the
 * k-anonymity floor, same rule panel-bench applies to `volume`.
 *
 * ponytail: average-of-the-book thresholding, no seasonal/segment baseline.
 * Upgrade path is the same one momentum.ts already names for its own
 * two-window scoring - richer baselines slot in without changing this shape.
 */
export function computeWhitespaceCandidates(
  quoteSignals: readonly RawSignal[],
  coverage: readonly CoverageInput[],
  now: number,
  windowMs?: number,
  kFloor: number = DEFAULT_K_FLOOR
): WhitespaceCandidate[] {
  const clusters = clusterSignals(quoteSignals, now, windowMs);
  const momentumByCategory = new Map(clusters.map((c) => [c.category, c]));
  const coverageByCategory = new Map(coverage.map((c) => [c.category, c.policyCount]));

  const categories = new Set([...momentumByCategory.keys(), ...coverageByCategory.keys()]);
  if (categories.size === 0) return [];

  const momentumOf = (category: string): number => momentumByCategory.get(category)?.momentum ?? 0;
  const coverageOf = (category: string): number => coverageByCategory.get(category) ?? 0;

  const avgMomentum = [...categories].reduce((sum, c) => sum + momentumOf(c), 0) / categories.size;
  const avgCoverage = [...categories].reduce((sum, c) => sum + coverageOf(c), 0) / categories.size;

  const out: WhitespaceCandidate[] = [];
  for (const category of categories) {
    const momentum = momentumOf(category);
    const cov = coverageOf(category);
    if (!(momentum > avgMomentum && cov < avgCoverage)) continue;

    const cellCount = momentumByCategory.get(category)?.signalIds.length ?? 0;
    out.push({
      category,
      momentum,
      coverage: cov,
      cellCount,
      visible: checkKAnonymity(cellCount, kFloor).allowed
    });
  }

  return out.sort((a, b) => b.momentum - a.momentum);
}
