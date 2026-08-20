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
// Which axes exist is the *pack's* answer (CLAUDE.md rule 14, docs/21 §3,
// ADR-0069); which axes may never exist is this file's, and a pack cannot
// overrule it. The affluence axis in particular is a market fact rather than a
// platform one: ZA buys media on LSM, a Gulf tenant has never heard of it, and
// hard-coding either leaves the other with no affluence axis at all — the single
// most important dimension in a media plan.
//
// ponytail: attributes live in `core_customers.tagsJson` under an `axis:value`
// grammar rather than in new columns. tagsJson is already the spine's flat
// string-array extension point ("vip", "portal-lead"), so a tenant can describe
// its book without a migration. Upgrade path is a real `customer_attributes`
// table the day a tenant needs typed values or per-attribute consent; only
// `countAttributes` changes.

import { DEFAULT_K_FLOOR } from "./k-anonymity.js";

/**
 * Axes no campaign may ever target on, whatever a tenant tagged and whatever a
 * pack declares.
 *
 * SIG-034 plus POPIA §26 "special personal information" (religious or
 * philosophical beliefs, race or ethnic origin, trade union membership,
 * political persuasion, health or sex life, biometric information, criminal
 * behaviour). Gender and sexual orientation are here too: the first is a
 * protected ground under the Equality Act, and neither can be inferred from a
 * tag without the tenant having collected it for a different purpose.
 *
 * Nationality, national origin and residency status are here for the Gulf, and
 * they are the entry a reviewer should argue with: nationality band is in
 * practice the single biggest UAE motor-pricing and media axis, so leaving it
 * out costs the pack real selling power. It stays out because a nationality tag
 * is a working proxy for `race` and `ethnicity` — the two axes directly above —
 * and a floor that any pack can route around with a synonym is not a floor.
 * Residency (citizen/resident/visitor) is the same proxy one step removed. An
 * underwriter may still *rate* on residency where the regulator allows it; that
 * is a rating factor in the quote engine, not a targeting dimension here.
 * ADR-0071 records the argument in full.
 *
 * Not pack-configurable, by construction: `defineTargetingPack` strips these
 * from whatever a pack declares, and `isTargetable` refuses them again on the
 * way out. A pack may rename and restrict (docs/21 §3); it may never weaken a
 * compliance floor.
 */
export const PROTECTED_AXES = [
  "race",
  "ethnicity",
  "nationality",
  "nationalorigin",
  "residency",
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

/** One band of an affluence scale, and what living in it means. */
export interface AffluenceBand {
  readonly band: number;
  readonly label: string;
}

/**
 * A banded affluence axis: the tag axis it is carried on, the noun a prompt or a
 * UI calls it, and one descriptor per band.
 *
 * ponytail: one descriptor per band, shared by the prompt (so the model is
 * grounded in what a band means rather than inventing it) and by the UI.
 */
export interface AffluenceScale {
  readonly axis: string;
  readonly label: string;
  readonly bands: readonly AffluenceBand[];
}

/** What a domain pack says a campaign may be aimed at. */
export interface TargetingPack {
  /** Axes a campaign may target on, in the order a UI offers them. Anything not
   *  named here is refused, so a new axis is a deliberate decision rather than
   *  whatever a tag happened to spell. */
  readonly axes: readonly string[];
  /** The pack's affluence scale, or null for a pack that bands on nothing. */
  readonly affluence: AffluenceScale | null;
}

function normalise(axis: string): string {
  return axis.trim().toLowerCase();
}

function isProtected(axis: string): boolean {
  return (PROTECTED_AXES as readonly string[]).includes(normalise(axis));
}

/**
 * A pack declaration, with the protected axes taken back out.
 *
 * Exported because a pack is configuration and configuration is written by
 * people: this is where "the UAE pack declares `race` as an affluence proxy"
 * dies, and it dies silently rather than by throwing, because a bad line in one
 * pack must not take the process down for every other tenant. An affluence axis
 * the pack did not also declare targetable is dropped for the same reason — a
 * scale nobody can select on is a label with no cells behind it.
 */
export function defineTargetingPack(
  axes: readonly string[],
  affluence: AffluenceScale | null
): TargetingPack {
  const declared = axes.map(normalise).filter((a) => a.length > 0 && !isProtected(a));
  const axis = affluence ? normalise(affluence.axis) : null;
  return {
    axes: declared,
    affluence: affluence && axis && declared.includes(axis) ? { ...affluence, axis } : null
  };
}

// A Map, not an object literal: `pack` arrives from tenant config, and
// `{}["constructor"]` is a truthy function, so an object lookup would hand a
// tenant `Object` as its targeting pack. Same posture as promptNouns in
// packages/model-gateway/src/vocabulary.ts.
const PACKS = new Map<string, TargetingPack>([
  [
    // The ZA default. LSM is the SAARF/BRC Living Standards Measure, 1 (least)
    // to 10 (most affluent) — the segmentation every ZA media plan is bought in.
    "insurance-retail",
    defineTargetingPack(["lsm", "ageband", "region", "language", "lifestage"], {
      axis: "lsm",
      label: "LSM",
      bands: [
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
      ]
    })
  ],
  [
    // The Gulf pack (the yallacompare shape): no LSM, because there is no LSM
    // outside southern Africa. Axes and their reasoning: ADR-0071.
    //
    // The scale is deliberately *not* a branded market index. There is no
    // SAARF/BRC equivalent we hold a licence to for the GCC, and naming one we
    // do not have would be a fabricated citation in a prompt a human funds a
    // campaign against. So this is a plain income quintile — the fifth of the
    // tenant's own book a customer's declared household income falls in, tagged
    // `incomequintile:1`..`:5` by whoever loads the book. The tenant owns the
    // cut; Lyra only owns the vocabulary.
    //
    // `region` for this pack means the seven emirates (`region:dubai`,
    // `region:abu-dhabi`, …) and `language` means en/ar, which is the split the
    // platform already renders in both directions. Neither needs pack-declared
    // values: only the affluence axis carries bands, every other axis is counted
    // straight off whatever the tenant tagged. A second GCC tenant (KSA regions,
    // SAR) reuses this pack unchanged — see ADR-0071 §5 for what it would have
    // to change and what it would not.
    //
    // Not here: nationality or residency band, the axis a UAE media buyer asks
    // for first. It is a proxy for race and ethnic origin, so it lives in
    // PROTECTED_AXES above rather than being quietly omitted here.
    "insurance-gulf",
    defineTargetingPack(["incomequintile", "ageband", "region", "language", "lifestage"], {
      axis: "incomequintile",
      label: "Income quintile",
      bands: [
        { band: 1, label: "Q1 — lowest fifth of declared household income" },
        { band: 2, label: "Q2 — lower-middle fifth" },
        { band: 3, label: "Q3 — middle fifth" },
        { band: 4, label: "Q4 — upper-middle fifth" },
        { band: 5, label: "Q5 — highest fifth of declared household income" }
      ]
    })
  ]
]);

const DEFAULT_TARGETING_PACK = PACKS.get("insurance-retail")!;

/**
 * The active pack's targeting vocabulary.
 *
 * An unknown or missing pack degrades to the default rather than to an empty
 * pack: no axes at all is not a safer failure, it is a tenant that silently
 * cannot target anything, and the default is the one PolicyJson.domainPack
 * already ships.
 */
export function targetingPack(pack?: string): TargetingPack {
  return PACKS.get(pack ?? "") ?? DEFAULT_TARGETING_PACK;
}

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
  const axis = normalise(tag.slice(0, at));
  const value = tag.slice(at + 1).trim();
  return axis && value ? { axis, value } : null;
}

/** Whether an axis may be targeted on under a pack. Unknown axes are refused,
 *  not allowed: a typo, a tenant's private tag, or another pack's axis must not
 *  become a targeting dimension here. */
export function isTargetable(axis: string, pack?: string): boolean {
  const a = normalise(axis);
  return targetingPack(pack).axes.includes(a) && !isProtected(a);
}

/**
 * Customer tag sets to one count per targetable `axis:value`, most common first.
 *
 * A protected axis is dropped here rather than downstream, so it never becomes
 * a countable cell at all and cannot leak through a caller that forgot to
 * filter. Duplicate tags on one customer count once.
 */
export function countAttributes(
  tagSets: readonly (readonly string[])[],
  pack?: string
): AttributeCount[] {
  const counts = new Map<string, AttributeCount>();
  for (const tags of tagSets) {
    const seen = new Set<string>();
    for (const tag of tags) {
      const attr = parseAttributeTag(tag);
      if (!attr || !isTargetable(attr.axis, pack)) continue;
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
export function targetablePool(
  counts: readonly AttributeCount[],
  floor: number = DEFAULT_K_FLOOR,
  pack?: string
): AttributeCount[] {
  return sortByCount(counts.filter((c) => isTargetable(c.axis, pack) && c.count >= floor));
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

/**
 * A tag read as a band on the pack's affluence scale, or null.
 *
 * Null covers three different "this is not a band": the pack has no affluence
 * scale, the axis is some other targetable axis (`region:7` is a cell, not a
 * band), or the value is off the scale. All three mean the same thing to a
 * caller — do not label this cell — so they answer the same way.
 */
export function affluenceBandOf(axis: string, value: string, pack?: string): AffluenceBand | null {
  const scale = targetingPack(pack).affluence;
  if (!scale || normalise(axis) !== scale.axis) return null;
  const v = value.trim();
  return /^\d+$/.test(v) ? (scale.bands.find((b) => b.band === Number(v)) ?? null) : null;
}

/** Most common first, then by axis and value so the order is stable across runs
 *  (a prompt whose evidence lines reshuffle is a prompt that cannot be cached). */
function sortByCount(counts: AttributeCount[]): AttributeCount[] {
  return counts.sort((a, b) => b.count - a.count || a.axis.localeCompare(b.axis) || a.value.localeCompare(b.value));
}
