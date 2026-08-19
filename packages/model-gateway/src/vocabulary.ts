// CLAUDE.md rule 14 / docs/21 §3, prompt side. The UI half of this seam lives in
// apps/web/app/modules/vocabulary.ts and ADR-0022 records what it deferred:
// "bespoke-route labellers, mobile, prompt-side vocabulary". This is the
// prompt-side half — the nouns a *system prompt* would otherwise hard-code.
//
// Deliberately not the web table: that one renames ~20 UI label keys per locale,
// a prompt needs three English nouns and no locale (the model is told which
// language to write in separately). Sharing one table would drag the whole
// label catalogue into every prompt build for two useful strings.

export interface PromptNouns {
  /** The industry a prompt says it is writing for. */
  domain: string;
  /** The unit of business the tenant sells, singular. */
  contract: string;
  /** …and plural, for "N contracts on the book". */
  contracts: string;
}

/** Packs absent from this table read as the default, same posture as the web half. */
export const DEFAULT_PACK = "insurance-retail";

// A Map, not an object literal: `pack` arrives from tenant config, and
// `{}["constructor"]` is a truthy function, so an object lookup would hand a
// prompt `Object` as its noun table instead of falling through to the default.
const PACKS = new Map<string, PromptNouns>([
  [DEFAULT_PACK, { domain: "insurance", contract: "policy", contracts: "policies" }],
  // docs/21 §5: retail_ecom — contract->order, insurer/underwriter->supplier.
  ["retail-ecom", { domain: "retail commerce", contract: "order", contracts: "orders" }],
  ["health-provider", { domain: "healthcare cover", contract: "plan", contracts: "plans" }],
  ["lending-credit", { domain: "lending", contract: "facility", contracts: "facilities" }]
]);

/**
 * The active pack's prompt nouns. An unknown or missing pack degrades to the
 * default rather than to an empty noun — a prompt reading "for a  " is worse
 * than one reading the wrong industry, and the default is the one
 * PolicyJson.domainPack already ships.
 */
export function promptNouns(pack: string | undefined): PromptNouns {
  return PACKS.get(pack ?? DEFAULT_PACK) ?? PACKS.get(DEFAULT_PACK)!;
}
