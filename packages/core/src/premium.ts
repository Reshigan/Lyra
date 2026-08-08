// docs/specs/gap-axis-design.md §F. Earned premium pro-rata over a policy
// version's [effectiveFrom, effectiveTo) term, clipped to a reporting window.

export type EarnableVersion = {
  effectiveFrom: number;
  effectiveTo: number;
  premiumMinor: number;
};

/** Premium earned by `version` during the overlap of its term and [from, to). */
export function earnedBetween(version: EarnableVersion, from: number, to: number): number {
  const overlapStart = Math.max(version.effectiveFrom, from);
  const overlapEnd = Math.min(version.effectiveTo, to);
  if (overlapEnd <= overlapStart) return 0;
  const span = version.effectiveTo - version.effectiveFrom;
  if (span <= 0) return 0;
  return Math.round((version.premiumMinor * (overlapEnd - overlapStart)) / span);
}
