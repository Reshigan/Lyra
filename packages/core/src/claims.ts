// docs/27 F23 / docs/specs/gap-axis-design.md §C.3. `incurredMinor` is never
// stored: a stored total drifts the moment a reserve moves, a payment lands or a
// recovery is banked, and every screen then quotes a different number. One
// function, one definition.

export type ClaimMoney = {
  paidMinor: number;
  reserveMinor: number;
  recoveredMinor: number;
};

/** Ultimate cost of a claim as it stands: paid + outstanding reserve - recovered. */
export function incurred(claim: ClaimMoney): number {
  return claim.paidMinor + claim.reserveMinor - claim.recoveredMinor;
}
