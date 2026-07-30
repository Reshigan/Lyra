import { describe, expect, it } from "vitest";
import {
  LABELS,
  PERM,
  TRANSITIONS,
  TXN_STATES,
  balanceCheck,
  labelIn,
  nextStates,
  txnActions
} from "./ledger.shared";

// The three pieces of judgement the ledger screens make before they render:
// which state moves to offer, whether the batch foots, and which of those two
// the actor is allowed to act on. Everything else on those screens is the API's
// answer printed back, and has nothing to get wrong.

describe("nextStates", () => {
  it("offers only the hops the machine allows", () => {
    expect(nextStates("initiated")).toEqual(["validated", "rejected", "failed"]);
    expect(nextStates("settled")).toEqual(["reversing", "adjusting"]);
  });

  it("offers nothing out of a terminal state", () => {
    for (const state of ["reversed", "failed", "rejected", "expired"]) {
      expect(nextStates(state)).toEqual([]);
    }
  });

  it("offers nothing for a state it does not know", () => {
    // A state the API grows and this mirror has not yet learned must render an
    // empty picker, never a free-text box that would post anything at all.
    expect(nextStates("teleported")).toEqual([]);
    expect(nextStates("")).toEqual([]);
  });

  it("never proposes a target outside the state list", () => {
    for (const state of TXN_STATES) {
      for (const to of TRANSITIONS[state]) expect(TXN_STATES).toContain(to);
    }
  });
});

describe("balanceCheck", () => {
  it("foots a balanced batch", () => {
    const check = balanceCheck([
      { side: "debit", amountMinor: 10_000 },
      { side: "credit", amountMinor: 7_500 },
      { side: "credit", amountMinor: 2_500 }
    ]);
    expect(check).toEqual({
      debitMinor: 10_000,
      creditMinor: 10_000,
      deltaMinor: 0,
      balanced: true,
      lineCount: 3
    });
  });

  it("reports the difference when it does not", () => {
    const check = balanceCheck([
      { side: "debit", amountMinor: 10_000 },
      { side: "credit", amountMinor: 9_999 }
    ]);
    expect(check.deltaMinor).toBe(1);
    expect(check.balanced).toBe(false);
  });

  it("signs the difference the way the shortfall runs", () => {
    expect(balanceCheck([{ side: "credit", amountMinor: 500 }]).deltaMinor).toBe(-500);
  });

  it("refuses to call a batch balanced when a side is not a side", () => {
    // A row the ledger could not have written. Counting it into neither total
    // would leave the totals equal and the batch silently wrong.
    const check = balanceCheck([
      { side: "debit", amountMinor: 100 },
      { side: "credit", amountMinor: 100 },
      { side: "sideways", amountMinor: 4_200 }
    ]);
    expect(check.deltaMinor).toBe(0);
    expect(check.balanced).toBe(false);
    expect(check.lineCount).toBe(3);
  });

  it("treats no lines as nothing to foot", () => {
    expect(balanceCheck([])).toEqual({
      debitMinor: 0,
      creditMinor: 0,
      deltaMinor: 0,
      balanced: true,
      lineCount: 0
    });
  });
});

describe("txnActions", () => {
  const all = new Set<string>([PERM.txnsAuthorize, PERM.txnsReverse]);

  it("offers both gates to an actor holding both permissions", () => {
    expect(txnActions(all, "settled")).toEqual({
      transitions: ["reversing", "adjusting"],
      canReverse: true
    });
  });

  it("withholds the state picker without ledger:txns:authorize", () => {
    const reverseOnly = new Set<string>([PERM.txnsReverse]);
    expect(txnActions(reverseOnly, "settled").transitions).toEqual([]);
    expect(txnActions(reverseOnly, "settled").canReverse).toBe(true);
  });

  it("withholds reversal without ledger:txns:reverse", () => {
    const authorizeOnly = new Set<string>([PERM.txnsAuthorize]);
    expect(txnActions(authorizeOnly, "settled").canReverse).toBe(false);
  });

  it("offers nothing to a reader", () => {
    expect(txnActions(new Set([PERM.txnsRead]), "settled")).toEqual({
      transitions: [],
      canReverse: false
    });
  });

  it("refuses reversal from any state but settled, permission or not", () => {
    // There is nothing to counter until money has posted; the ledger package
    // throws a conflict, and offering the button anyway would be a lie.
    for (const state of TXN_STATES.filter((s) => s !== "settled")) {
      expect(txnActions(all, state).canReverse).toBe(false);
    }
  });

  it("reads the permission strings the API enforces", () => {
    expect(PERM.txnsAuthorize).toBe("ledger:txns:authorize");
    expect(PERM.txnsReverse).toBe("ledger:txns:reverse");
    expect(PERM.periodsClose).toBe("ledger:periods:close");
    expect(PERM.reconConfirm).toBe("ledger:recon:confirm");
  });
});

describe("labelIn", () => {
  it("interpolates the variables a screen passes", () => {
    expect(labelIn("en")("txn.moved", { state: "Settled" })).toBe("Moved to Settled.");
  });

  it("falls back to English rather than showing a key", () => {
    expect(labelIn("de")("txn.title")).toBe(LABELS.en!["txn.title"]);
  });

  it("translates every English key into Arabic", () => {
    // RTL from day one (CLAUDE.md §7): a half-translated screen is a bug, not a
    // gradual rollout.
    const missing = Object.keys(LABELS.en!).filter((key) => !(key in LABELS.ar!));
    expect(missing).toEqual([]);
  });

  it("names every transaction state in both locales", () => {
    for (const locale of ["en", "ar"]) {
      for (const state of TXN_STATES) expect(LABELS[locale]![`state.${state}`]).toBeTruthy();
    }
  });
});
