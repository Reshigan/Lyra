// docs/27 F5 / docs/specs/gap-axis-design.md §C.2. SQLite cannot express
// "exactly one effective version" or "intervals are contiguous", so the
// invariants live here as one pure checker the lifecycle endpoints and their
// tests both call. Returns every violation rather than throwing on the first
// one — a caller that has corrupted two things wants to see both.

export type PolicyVersionRow = {
  id: string;
  versionSeq: number;
  effectiveFrom: number;
  effectiveTo: number;
  state: string;
  premiumMinor: number;
  premiumDeltaMinor: number;
};

export type PolicyHeadRow = {
  currentVersionId: string | null;
  versionSeq: number;
  premiumMinor: number;
};

/** Empty array = the policy's version history is well formed. */
export function policyVersionViolations(
  head: PolicyHeadRow,
  versions: readonly PolicyVersionRow[]
): string[] {
  const out: string[] = [];
  if (versions.length === 0) return ["policy has no versions"];

  const live = versions.filter((v) => v.state !== "voided");
  const bySeq = [...live].sort((a, b) => a.versionSeq - b.versionSeq);

  const effective = live.filter((v) => v.state === "effective");
  if (effective.length !== 1) {
    out.push(`expected exactly one effective version, found ${effective.length}`);
  }

  // Dense from 1. Voided rows still consume a seq (the unique index is on the
  // whole table), so density is asserted over every row, not just the live ones.
  const allSeqs = [...versions].map((v) => v.versionSeq).sort((a, b) => a - b);
  for (let i = 0; i < allSeqs.length; i++) {
    if (allSeqs[i] !== i + 1) {
      out.push(`versionSeq is not dense from 1: ${allSeqs.join(",")}`);
      break;
    }
  }

  for (const v of bySeq) {
    if (v.effectiveTo <= v.effectiveFrom) {
      out.push(`version ${v.versionSeq} has a non-positive interval`);
    }
  }
  for (let i = 1; i < bySeq.length; i++) {
    const prev = bySeq[i - 1]!;
    const cur = bySeq[i]!;
    if (cur.effectiveFrom !== prev.effectiveTo) {
      out.push(
        `versions ${prev.versionSeq} and ${cur.versionSeq} are not contiguous: ` +
          `${prev.effectiveTo} != ${cur.effectiveFrom}`
      );
    }
  }

  const current = effective[0];
  if (current) {
    if (head.currentVersionId !== current.id) {
      out.push(`head.currentVersionId does not point at the effective version`);
    }
    if (head.versionSeq !== current.versionSeq) {
      out.push(
        `head.versionSeq ${head.versionSeq} != effective version ${current.versionSeq}`
      );
    }
  }

  const v1 = bySeq[0];
  if (v1) {
    // v1's delta is the issue itself, not a change, so the sum starts after it.
    const sumDelta = bySeq.slice(1).reduce((n, v) => n + v.premiumDeltaMinor, 0);
    const headDelta = head.premiumMinor - v1.premiumMinor;
    if (sumDelta !== headDelta) {
      out.push(`premium deltas sum to ${sumDelta} but the head moved ${headDelta}`);
    }
  }

  return out;
}
