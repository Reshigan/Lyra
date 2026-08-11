import { describe, expect, it } from "vitest";
import {
  LABELS,
  PERM,
  argsFromForm,
  statementFromCsv,
  TRANSITIONS,
  TXN_STATES,
  balanceCheck,
  checkName,
  labelIn,
  nextStates,
  txnActions,
  type ArgField
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

  // /ledger/period-close with no ?period= reused the denied copy, so a
  // controller who simply hadn't picked a period yet was told they lacked
  // permission to be there (docs/ui.md §7.13).
  it("does not tell a permitted user they lack access when no period is chosen", () => {
    for (const locale of ["en", "ar"]) {
      expect(LABELS[locale]!["period.noneSelected"]).toBeTruthy();
      expect(LABELS[locale]!["period.noneSelected"]).not.toBe(LABELS[locale]!.denied);
      expect(LABELS[locale]!["period.noneSelectedBody"]).toBeTruthy();
    }
  });

  it("names every transaction state in both locales", () => {
    for (const locale of ["en", "ar"]) {
      for (const state of TXN_STATES) expect(LABELS[locale]![`state.${state}`]).toBeTruthy();
    }
  });
});

// The close screen printed `no_pending_external@2026-08` in the blocking banner
// and down the checks table — the ledger's own name for the check, period
// suffix and all, where the period is already the heading above it.
describe("checkName", () => {
  const l = labelIn("en");

  it("says the check and drops the period the heading already gives", () => {
    expect(checkName("no_pending_external@2026-08", l)).toBe("Nothing still waiting on a provider");
    expect(checkName("trial_balance_zero@2026-08", l)).toBe("Debits equal credits");
  });

  it("still reads as words when nobody wrote a label for the check", () => {
    expect(checkName("some_new_check@2026-08", l)).toBe("Some new check");
  });

  it("says it in Arabic too", () => {
    expect(checkName("no_pending_external@2026-08", labelIn("ar"))).not.toContain("_");
  });
});

// docs/ui.md §7 P3-16: the open-transaction screen asked a controller to type
// the recipe's arguments as JSON. `GET /txn-types` now publishes the field list
// and the form posts one input per field, so this is the reader of that form.
describe("argsFromForm", () => {
  const fields: ArgField[] = [
    { name: "amountMinor", kind: "integer", required: true },
    { name: "feeMinor", kind: "integer", required: false, default: 0 },
    { name: "cashAccount", kind: "text", required: false, default: "1000" },
    { name: "memo", kind: "text", required: false }
  ];

  function form(entries: Record<string, string>): FormData {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.set(k, v);
    return data;
  }

  it("reads each field off its own input and numbers the integers", () => {
    expect(argsFromForm(fields, form({ "arg.amountMinor": "150000", "arg.feeMinor": "250" }))).toEqual({
      amountMinor: 150000,
      feeMinor: 250
    });
  });

  it("leaves a blank field out so the recipe's own default stands", () => {
    expect(argsFromForm(fields, form({ "arg.amountMinor": "1", "arg.cashAccount": "  " }))).toEqual({
      amountMinor: 1
    });
  });

  it("keeps text as text, trimmed", () => {
    expect(argsFromForm(fields, form({ "arg.memo": " renewal " }))).toEqual({ memo: "renewal" });
  });

  it("ignores anything the field list did not ask for", () => {
    expect(argsFromForm(fields, form({ "arg.somethingElse": "9", type: "BIND" }))).toEqual({});
  });

  it("passes a non-numeric amount through for the ledger to refuse by name", () => {
    expect(argsFromForm(fields, form({ "arg.amountMinor": "lots" }))).toEqual({ amountMinor: "lots" });
  });
});

describe("statementFromCsv", () => {
  it("reads reference, amount, our reference, date and description in column order", () => {
    const parsed = statementFromCsv(
      "INS-8891,1500.55,TXN-01,2026-08-01,August premium\n",
      "ZAR"
    );
    expect(parsed.rejected).toEqual([]);
    expect(parsed.lines).toEqual([
      {
        ref: "INS-8891",
        amountMinor: 150055,
        currency: "ZAR",
        ourRef: "TXN-01",
        postedAt: Date.parse("2026-08-01"),
        description: "August premium"
      }
    ]);
  });

  it("needs only a reference and an amount", () => {
    expect(statementFromCsv("INS-1,20", "ZAR").lines).toEqual([
      { ref: "INS-1", amountMinor: 2000, currency: "ZAR" }
    ]);
  });

  it("skips a header row rather than refusing it", () => {
    const parsed = statementFromCsv("Reference,Amount\nINS-1,20", "ZAR");
    expect(parsed.rejected).toEqual([]);
    expect(parsed.lines.map((line) => line.ref)).toEqual(["INS-1"]);
  });

  it("takes the columns tab-separated too, the way a spreadsheet pastes", () => {
    expect(statementFromCsv("INS-1\t20\tTXN-01", "ZAR").lines).toEqual([
      { ref: "INS-1", amountMinor: 2000, currency: "ZAR", ourRef: "TXN-01" }
    ]);
  });

  it("keeps a quoted description whole when it carries a comma", () => {
    const parsed = statementFromCsv('INS-1,20,,,"Premium, less fee"', "ZAR");
    expect(parsed.lines[0]?.description).toBe("Premium, less fee");
  });

  it("counts the currency's own precision", () => {
    expect(statementFromCsv("INS-1,500", "JPY").lines[0]?.amountMinor).toBe(500);
    expect(statementFromCsv("INS-1,500", "KWD").lines[0]?.amountMinor).toBe(500000);
  });

  it("keeps a credit negative — a statement has both directions", () => {
    expect(statementFromCsv("INS-1,-42.10", "ZAR").lines[0]?.amountMinor).toBe(-4210);
  });

  it("names the row it could not read instead of dropping it quietly", () => {
    const parsed = statementFromCsv("INS-1,20\nINS-2,about twenty\n,30", "ZAR");
    expect(parsed.lines.map((line) => line.ref)).toEqual(["INS-1"]);
    expect(parsed.rejected).toEqual([
      { row: 2, text: "INS-2,about twenty" },
      { row: 3, text: ",30" }
    ]);
  });

  it("ignores blank rows and trailing whitespace", () => {
    expect(statementFromCsv("\n INS-1 , 20 \n\n", "ZAR").lines).toEqual([
      { ref: "INS-1", amountMinor: 2000, currency: "ZAR" }
    ]);
  });

  it("leaves the date out when it is not a date the browser agrees on", () => {
    expect(statementFromCsv("INS-1,20,,not-a-date", "ZAR").lines[0]).not.toHaveProperty("postedAt");
  });

  it("says nothing for an empty paste", () => {
    expect(statementFromCsv("   ", "ZAR")).toEqual({ lines: [], rejected: [] });
  });
});
