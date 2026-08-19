import { describe, expect, it } from "vitest";
import { detailHeadlineKey, netBalance, netLegs } from "./settlement-detail";

describe("detailHeadlineKey", () => {
  it("flags a ledger mismatch even when a decision is open", () => {
    expect(detailHeadlineKey(false, 2)).toBe("mismatch");
  });

  it("calls out an open decision when the net holds", () => {
    expect(detailHeadlineKey(true, 1)).toBe("actionable");
  });

  it("falls back to a plain readout once nothing is open", () => {
    expect(detailHeadlineKey(true, 0)).toBe("plain");
  });
});

/* ------------------------------------------------------------- the money flow */

// What the flow diagram draws for a settlement: what the period earned less what
// was adjusted, arriving as the net that will be paid. The two sides are the
// same invariant `netHolds` checks, so the picture cannot claim a total the
// arithmetic does not support (CLAUDE.md §12).

const l = (key: string) => key;
const totals = { grossMinor: 500_00, adjustmentsMinor: -50_00, netMinor: 450_00 };

describe("netLegs", () => {
  it("puts what was earned and what was adjusted against what is payable", () => {
    expect(netLegs(totals, l).map((leg) => [leg.account, leg.side, leg.amountMinor])).toEqual([
      ["gross", "debit", 500_00],
      ["adjustments", "debit", -50_00],
      ["net", "credit", 450_00]
    ]);
  });

  it("adds up to the totals the balance reports, side for side", () => {
    const balance = netBalance(totals);
    const legs = netLegs(totals, l);
    const sum = (side: string) =>
      legs.filter((leg) => leg.side === side).reduce((n, leg) => n + leg.amountMinor, 0);
    expect(sum("debit")).toBe(balance.debitMinor);
    expect(sum("credit")).toBe(balance.creditMinor);
  });
});

describe("netBalance", () => {
  it("balances when gross and adjustments make the net", () => {
    expect(netBalance(totals)).toEqual({
      debitMinor: 450_00,
      creditMinor: 450_00,
      deltaMinor: 0,
      balanced: true
    });
  });

  it("names the discrepancy, signed, when they do not", () => {
    const bad = { grossMinor: 500_00, adjustmentsMinor: -50_00, netMinor: 500_00 };
    expect(netBalance(bad)).toEqual({
      debitMinor: 450_00,
      creditMinor: 500_00,
      deltaMinor: -50_00,
      balanced: false
    });
  });
});
