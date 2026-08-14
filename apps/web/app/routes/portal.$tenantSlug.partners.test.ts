import { describe, expect, it } from "vitest";
import { LABELS, firstCall, usageTotals, type PartnerTxn } from "./portal.$tenantSlug.partners";

// docs/modules/orbit.md §4 screen 5. The only logic on the page is the money:
// what the partner has written, what their share of it is, and what has not
// been paid out yet.

const txn = (over: Partial<PartnerTxn> = {}): PartnerTxn => ({
  id: `ptx_${over.kind ?? "quote"}_${over.ts ?? 0}`,
  kind: "quote",
  amountMinor: 0,
  currency: "ZAR",
  revshareCalcMinor: 0,
  settlementBatch: null,
  ts: 1_760_000_000_000,
  ...over
});

describe("usageTotals", () => {
  it("sums what was written and what the partner earns on it", () => {
    expect(
      usageTotals([
        txn({ id: "a", kind: "bind", amountMinor: 120_000, revshareCalcMinor: 12_000 }),
        txn({ id: "b", kind: "bind", amountMinor: 80_000, revshareCalcMinor: 8_000 })
      ])
    ).toEqual({ calls: 2, grossMinor: 200_000, revshareMinor: 20_000, unsettledMinor: 20_000, currency: "ZAR" });
  });

  it("takes a refund back off both the gross and the share", () => {
    const totals = usageTotals([
      txn({ id: "a", kind: "bind", amountMinor: 100_000, revshareCalcMinor: 10_000 }),
      txn({ id: "b", kind: "refund", amountMinor: 40_000, revshareCalcMinor: 4_000 })
    ]);
    expect(totals.grossMinor).toBe(60_000);
    expect(totals.revshareMinor).toBe(6_000);
  });

  it("counts only the rows no settlement batch has claimed", () => {
    const totals = usageTotals([
      txn({ id: "a", kind: "bind", revshareCalcMinor: 10_000, settlementBatch: "stl_2026_07" }),
      txn({ id: "b", kind: "bind", revshareCalcMinor: 3_000 })
    ]);
    expect(totals.revshareMinor).toBe(13_000);
    expect(totals.unsettledMinor).toBe(3_000);
  });

  it("withholds a headline currency when the rows disagree", () => {
    expect(usageTotals([txn({ id: "a" }), txn({ id: "b", currency: "USD" })]).currency).toBeNull();
  });

  it("survives a partner who has not called anything yet", () => {
    expect(usageTotals([])).toEqual({
      calls: 0,
      grossMinor: 0,
      revshareMinor: 0,
      unsettledMinor: 0,
      currency: null
    });
  });
});

describe("firstCall", () => {
  it("puts the partner's own key in the command, not a placeholder to fill in", () => {
    const command = firstCall("https://api.lyra.example", "qvk_test_ABCDEF");
    expect(command).toContain("Authorization: Bearer qvk_test_ABCDEF");
    expect(command).toContain("https://api.lyra.example/v1/dist/offerings");
  });
});

describe("this screen's own labels speak both locales", () => {
  it("has the same keys in en and ar", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("never leaves an Arabic string empty or identical to the English", () => {
    for (const [key, english] of Object.entries(LABELS.en ?? {})) {
      const arabic = LABELS.ar?.[key] ?? "";
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
    }
  });
});
