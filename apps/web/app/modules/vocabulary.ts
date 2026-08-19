// Domain-pack vocabulary (CLAUDE.md §14, docs/21 §3): a pack renames nouns,
// never entities. The tenant's policy carries `domainPack`; the shell loader
// surfaces it and `labelsFor` consults this table before the workspace's own
// catalogue, so the same axis/dist/orbit screens sell outside insurance
// without touching a spec.
//
// Keys are the same label keys the workspace tables use (bare and qualified
// both resolve — see optionLabel in spec.ts). Only *insurance* nouns belong
// here: `policyKey` (approval/governance policy) and admin's `policyJson`
// (tenant settings) are platform vocabulary and stay out.
//
// ADR-0022 records the seam and what is deferred (bespoke-route labellers,
// mobile, prompt-side vocabulary).

/** Packs absent from this table — including the default — read as identity. */
export const DEFAULT_PACK = "insurance-retail";

const PACKS: Record<string, Record<string, Record<string, string>>> = {
  // docs/21 §5: retail_ecom — contract→order, claim→return, renewal→reorder,
  // insurer/underwriter→supplier, premium→order value.
  "retail-ecom": {
    en: {
      policies: "Orders",
      policyNo: "Order number",
      policyId: "Order",
      policyRef: "Order reference",
      premiumMinor: "Order value",
      minPremiumMinor: "Minimum order value",
      bestPremiumMinor: "Best price",
      claims: "Returns",
      claimNo: "Return number",
      renewals: "Reorders",
      renewal: "Reorder",
      "kind.renewal": "Reorder",
      coverageJson: "Entitlements",
      insurer: "Supplier",
      "process.insurer": "Supplier",
      "counterpartyKind.insurer": "Supplier",
      "collectsPayment.underwriter": "Supplier collects"
    },
    ar: {
      policies: "الطلبات",
      policyNo: "رقم الطلب",
      policyId: "الطلب",
      policyRef: "مرجع الطلب",
      premiumMinor: "قيمة الطلب",
      minPremiumMinor: "الحد الأدنى لقيمة الطلب",
      bestPremiumMinor: "أفضل سعر",
      claims: "المرتجعات",
      claimNo: "رقم المرتجع",
      renewals: "إعادة الطلبات",
      renewal: "إعادة طلب",
      "kind.renewal": "إعادة طلب",
      coverageJson: "الاستحقاقات",
      insurer: "المورّد",
      "process.insurer": "المورّد",
      "counterpartyKind.insurer": "المورّد",
      "collectsPayment.underwriter": "يحصّل المورّد"
    }
  }
};

/** Every noun a pack may rename. The guard in shell.test.ts scans for these. */
export const PACK_KEYS: readonly string[] = Object.keys(PACKS["retail-ecom"]!.en!);

/**
 * The pack's word for a label key, or undefined when the pack has no opinion —
 * in which case the workspace's own catalogue answers as it always did. An
 * unknown pack name degrades to identity rather than breaking every label.
 */
export function vocabulary(
  pack: string | undefined,
  locale: string
): (key: string) => string | undefined {
  const tables = PACKS[pack ?? DEFAULT_PACK];
  if (!tables) return () => undefined;
  const own = tables[locale] ?? {};
  const en = tables.en ?? {};
  return (key) => own[key] ?? en[key];
}
