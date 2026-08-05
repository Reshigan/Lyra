// ADR-0028. A flag is either explicit-list or global math, never both, so
// there is never a case where two rules disagree about one tenant.

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  targetTenantIdsJson: string | null;
}

/** FNV-1a. Deterministic membership, not a security hash. */
function bucket(tenantId: string, flagKey: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${flagKey}:${tenantId}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export function flagEnabled(flag: FeatureFlag, tenantId: string): boolean {
  if (!flag.enabled) return false; // kill-switch always wins
  const targets: string[] = flag.targetTenantIdsJson ? JSON.parse(flag.targetTenantIdsJson) : [];
  if (targets.length > 0) return targets.includes(tenantId);
  return bucket(tenantId, flag.key) < flag.rolloutPercent;
}
