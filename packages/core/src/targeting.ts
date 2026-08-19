// The vocabulary a targeting pool is allowed to be described in.
//
// docs/17-user-spec-benchmark.md §SIG-034 — "Protected attributes excluded from
// targeting and scoring models" — is the constraint this file answers to, and
// docs/specs/gap-signal-design.md §H.2 is the boundary it works inside: the
// model proposing an audience "never queries customer rows — it is given
// aggregate counts per attribute, above the k-anonymity floor, and proposes a
// rule over attribute names". This module is the counting and the filtering
// halves of that sentence. Pure, DB-free, so the evals score the same code the
// engine runs.
//
// ponytail: attributes live in `core_customers.tagsJson` under an `axis:value`
// grammar rather than in new columns. tagsJson is already the spine's flat
// string-array extension point ("vip", "portal-lead"), so a tenant can describe
// its book without a migration. Upgrade path is a real `customer_attributes`
// table the day a tenant needs typed values or per-attribute consent; only
// `countAttributes` changes.

import { DEFAULT_K_FLOOR } from "./k-anonymity.js";

/** Axes a campaign may target on. Anything not named here is refused, so a new
 *  axis is a deliberate decision rather than whatever a tag happened to spell. */
export const TARGETABLE_AXES = ["lsm", "ageband", "region", "language", "lifestage"] as const;

/**
 * Axes no campaign may ever target on, whatever a tenant tagged.
 *
 * SIG-034 plus POPIA §26 "special personal information" (religious or
 * philosophical beliefs, race or ethnic origin, trade union membership,
 * political persuasion, health or sex life, biometric information, criminal
 * behaviour). Gender and sexual orientation are here too: the first is a
 * protected ground under the Equality Act, and neither can be inferred from a
 * tag without the tenant having collected it for a different purpose.
 */
export const PROTECTED_AXES = [
  "race",
  "ethnicity",
  "religion",
  "belief",
  "health",
  "disability",
  "gender",
  "sex",
  "sexualorientation",
  "politics",
  "unionmembership",
  "biometrics",
  "criminalrecord"
] as const;

/**
 * The South African LSM scale (SAARF/BRC), 1 (least) to 10 (most affluent) —
 * the segmentation every ZA media plan is bought in.
 *
 * ponytail: one descriptor per band, shared by the prompt (so the model is
 * grounded in what a band means rather than inventing it) and by the UI. A
 * tenant outside ZA opts out of the axis by not tagging on it; nothing here is
 * load-bearing for a pack that does not use LSM.
 */
export const LSM_BANDS = [
  { band: 1, label: "LSM 1 — rural, minimal services" },
  { band: 2, label: "LSM 2 — rural, electricity, no durables" },
  { band: 3, label: "LSM 3 — informal urban, basic durables" },
  { band: 4, label: "LSM 4 — township, first appliances" },
  { band: 5, label: "LSM 5 — lower middle, entry credit" },
  { band: 6, label: "LSM 6 — middle, first vehicle and insurance" },
  { band: 7, label: "LSM 7 — upper middle, multiple durables" },
  { band: 8, label: "LSM 8 — affluent suburban, two vehicles" },
  { band: 9, label: "LSM 9 — wealthy, full financial services" },
  { band: 10, label: "LSM 10 — top of market" }
] as const;

export type LsmBand = (typeof LSM_BANDS)[number];

export interface Attribute {
  readonly axis: string;
  readonly value: string;
}

export interface AttributeCount extends Attribute {
  /** How many customers carry it. Never leaves the server below the floor. */
  readonly count: number;
}

/** `"lsm:7"` becomes `{ axis: "lsm", value: "7" }`; a tag with no axis is null.
 *  Splits on the first colon only, so a value may contain one. */
export function parseAttributeTag(tag: string): Attribute | null {
  const at = tag.indexOf(":");
  if (at < 0) return null;
  const axis = tag.slice(0, at).trim().toLowerCase();
  const value = tag.slice(at + 1).trim();
  return axis && value ? { axis, value } : null;
}

/** Whether an axis may be targeted on. Unknown axes are refused, not allowed:
 *  a typo or a tenant's private tag must not become a targeting dimension. */
export function isTargetable(axis: string): boolean {
  const a = axis.trim().toLowerCase();
  return (TARGETABLE_AXES as readonly string[]).includes(a) && !(PROTECTED_AXES as readonly string[]).includes(a);
}

/**
 * Customer tag sets to one count per targetable `axis:value`, most common first.
 *
 * A protected axis is dropped here rather than downstream, so it never becomes
 * a countable cell at all and cannot leak through a caller that forgot to
 * filter. Duplicate tags on one customer count once.
 */
export function countAttributes(tagSets: readonly (readonly string[])[]): AttributeCount[] {
  const counts = new Map<string, AttributeCount>();
  for (const tags of tagSets) {
    const seen = new Set<string>();
    for (const tag of tags) {
      const attr = parseAttributeTag(tag);
      if (!attr || !isTargetable(attr.axis)) continue;
      const key = `${attr.axis}:${attr.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = counts.get(key);
      counts.set(key, { ...attr, count: (prev?.count ?? 0) + 1 });
    }
  }
  return sortByCount([...counts.values()]);
}

/**
 * The counts a model may be shown: targetable axes only, and only cells at or
 * above the k-anonymity floor — the same rule panel-bench and the whitespace
 * radar apply, for the same reason (docs/modules/scout.md §2.5). A thin cell
 * names the handful of people behind it.
 */
export function targetablePool(counts: readonly AttributeCount[], floor: number = DEFAULT_K_FLOOR): AttributeCount[] {
  return sortByCount(counts.filter((c) => isTargetable(c.axis) && c.count >= floor));
}

/**
 * A ceiling on the pool a selection reaches, from marginal counts alone.
 *
 * Values within one axis are alternatives, so they add. Axes intersect, and
 * marginals cannot say by how much — so the smallest axis is the ceiling, and
 * that is the honest number to put in front of a human deciding a spend.
 * ponytail: exact reach needs the resolver to run the rule tree over the book;
 * this is the estimate shown before anyone commits to that.
 */
export function estimateReach(selected: readonly Attribute[], counts: readonly AttributeCount[]): number {
  const byAxis = new Map<string, number>();
  for (const sel of selected) {
    const found = counts.find((c) => c.axis === sel.axis && c.value === sel.value);
    byAxis.set(sel.axis, (byAxis.get(sel.axis) ?? 0) + (found?.count ?? 0));
  }
  return byAxis.size === 0 ? 0 : Math.min(...byAxis.values());
}

/** An LSM tag value read as its band, or null if it is not one of the ten. */
export function lsmBandOf(value: string): LsmBand | null {
  const v = value.trim();
  return /^\d+$/.test(v) ? (LSM_BANDS.find((b) => b.band === Number(v)) ?? null) : null;
}

/** Most common first, then by axis and value so the order is stable across runs
 *  (a prompt whose evidence lines reshuffle is a prompt that cannot be cached). */
function sortByCount(counts: AttributeCount[]): AttributeCount[] {
  return counts.sort((a, b) => b.count - a.count || a.axis.localeCompare(b.axis) || a.value.localeCompare(b.value));
}
