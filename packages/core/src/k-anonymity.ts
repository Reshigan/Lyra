// docs/modules/scout.md §2.5 — an aggregate cell that describes fewer than
// its floor's worth of underlying records can name the one counterparty
// behind it (a panel-bench row is a provider x line x period cut, so a thin
// one is one provider), so it must never leave the server: suppress it
// instead of returning it half-anonymous.

/** Default floor for a SCOUT aggregate with no product-specific `aggregationMin`. */
export const DEFAULT_K_FLOOR = 20;

export interface KAnonymityResult {
  readonly allowed: boolean;
  readonly cellCount: number;
  readonly floor: number;
}

/** A cell of exactly `floor` records is the smallest one still allowed through. */
export function checkKAnonymity(cellCount: number, floor: number): KAnonymityResult {
  return { allowed: cellCount >= floor, cellCount, floor };
}
