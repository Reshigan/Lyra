import type { DirectoryEntry } from "./api.server";

/**
 * The directory (ADR-0047) already holds every colleague's name, so a screen
 * that has fetched it names its owners and assignees from that rather than
 * resolving the same refs twice. A team is stored bare (`tm_…`) but listed as
 * `team:tm_…`, hence the suffix match.
 */
export function whoIs(entries: readonly DirectoryEntry[], ref: string | null): string | null {
  if (!ref) return null;
  return entries.find((entry) => entry.ref === ref || entry.ref.endsWith(`:${ref}`))?.name ?? null;
}
