import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostingFlow, StateFlow, flowPlan, type FlowMachine } from "./flow.js";

// A process flow is a state machine and a set of posted journal lines. Both are
// facts held elsewhere — docs/19 §3 for the machine, the ledger for the money —
// so everything here is about refusing to draw anything that is not one of
// those facts: no invented state, no balance the legs on screen contradict.

/** docs/19 §3, verbatim. The fixture is the documented machine, not a subset. */
const TXN = {
  transitions: {
    initiated: ["validated", "rejected", "failed"],
    validated: ["authorized", "rejected", "failed"],
    authorized: ["executing", "failed", "rejected"],
    executing: ["settled", "pending_external", "failed"],
    pending_external: ["executing", "failed", "expired"],
    settled: ["reversing", "adjusting"],
    reversing: ["reversed", "failed"],
    reversed: [],
    adjusting: ["adjusted", "failed"],
    adjusted: ["reversing"],
    failed: [],
    rejected: [],
    expired: []
  },
  spine: ["initiated", "validated", "authorized", "executing", "settled"],
  exits: ["failed", "rejected", "expired"]
} as const satisfies FlowMachine;

const at = (iso: string) => Date.parse(iso);

/* ------------------------------------------------------------------ the plan */

describe("flowPlan", () => {
  it("walks the history that happened, then pends the rest of the spine", () => {
    const plan = flowPlan(
      TXN,
      [
        { state: "initiated", at: at("2026-08-01T09:00:00Z") },
        { state: "validated", at: at("2026-08-01T09:01:00Z") }
      ],
      "validated"
    );
    expect(plan.steps.map((s) => [s.state, s.status])).toEqual([
      ["initiated", "done"],
      ["validated", "current"],
      ["authorized", "pending"],
      ["executing", "pending"],
      ["settled", "pending"]
    ]);
  });

  it("draws no state the machine does not document", () => {
    const plan = flowPlan(TXN, [{ state: "initiated" }, { state: "vibing" }], "vibing");
    expect(plan.steps.map((s) => s.state)).not.toContain("vibing");
    expect(plan.unknown).toEqual(["vibing"]);
    for (const step of plan.steps) {
      expect(Object.keys(TXN.transitions)).toContain(step.state);
    }
  });

  it("refuses a spine edge the machine does not document", () => {
    expect(() =>
      flowPlan({ transitions: TXN.transitions, spine: ["initiated", "settled"] }, [], "initiated")
    ).toThrow(/initiated/);
  });

  it("refuses a spine state the machine has never heard of", () => {
    expect(() =>
      flowPlan({ transitions: TXN.transitions, spine: ["initiated", "vibing"] }, [], "initiated")
    ).toThrow(/vibing/);
  });

  it("pends nothing once a terminal state is reached", () => {
    const plan = flowPlan(TXN, [{ state: "initiated" }, { state: "rejected" }], "rejected");
    expect(plan.steps.map((s) => s.state)).toEqual(["initiated", "rejected"]);
  });

  it("names the one documented next step from a state off the spine", () => {
    const plan = flowPlan(TXN, [{ state: "settled" }, { state: "reversing" }], "reversing");
    expect(plan.steps.map((s) => [s.state, s.status])).toEqual([
      ["settled", "done"],
      ["reversing", "current"],
      ["reversed", "pending"]
    ]);
  });

  it("shows the state a transaction is in even with no history recorded", () => {
    const plan = flowPlan(TXN, [], "executing");
    expect(plan.steps.map((s) => [s.state, s.status])).toEqual([
      ["executing", "current"],
      ["settled", "pending"]
    ]);
  });

  it("keeps a state that was entered twice, twice", () => {
    const plan = flowPlan(
      TXN,
      [{ state: "executing" }, { state: "pending_external" }, { state: "executing" }],
      "executing"
    );
    expect(plan.steps.map((s) => s.state)).toEqual([
      "executing",
      "pending_external",
      "executing",
      "settled"
    ]);
  });
});

/* ----------------------------------------------------------------- StateFlow */

describe("StateFlow", () => {
  const render = (current: string) =>
    renderToStaticMarkup(
      <StateFlow
        machine={TXN}
        current={current}
        visits={[
          { state: "initiated", at: at("2026-08-01T09:00:00Z"), actor: "user:dana" },
          { state: "validated", at: at("2026-08-01T09:01:00Z"), detail: "premium matched" }
        ]}
        label="Transaction progress"
        labelFor={(state) => `state:${state}`}
      />
    );

  it("marks exactly one step as the current one", () => {
    const markup = render("validated");
    expect([...markup.matchAll(/aria-current="step"/g)]).toHaveLength(1);
  });

  it("is an ordered list a screen reader can walk, not a picture", () => {
    const markup = render("validated");
    expect(markup).toContain('aria-label="Transaction progress"');
    expect(markup).toContain("<ol");
    expect(markup).not.toContain("<svg");
    // Every state is named in text, translated by the caller.
    for (const state of TXN.spine) expect(markup).toContain(`state:${state}`);
  });

  it("says what happened when, and what is still waiting", () => {
    const markup = render("validated");
    expect(markup).toContain("<time");
    expect(markup).toContain("premium matched");
    expect(markup).toContain("user:dana");
    expect(markup).toContain("Waiting");
  });

  it("wraps at phone width instead of scrolling the page sideways", () => {
    const markup = render("validated");
    expect(markup).toMatch(/class="[^"]*flex-wrap/);
    expect(markup).not.toMatch(/overflow-x/);
    expect(markup).not.toMatch(/min-w-\[/);
  });

  it("carries no information in movement", () => {
    // Reduced motion collapses every animation to 0.01ms (tokens.css), and
    // `motion-safe:` means it never starts. Either way the words remain.
    for (const match of render("validated").matchAll(/[\w:-]*animate-[\w-]+/g)) {
      expect(match[0]).toMatch(/^motion-safe:/);
    }
  });
});

/* --------------------------------------------------------------- PostingFlow */

const LEGS = [
  { id: "1", account: "1010", label: "Cash held", side: "debit", amountMinor: 120_00, sealed: true },
  { id: "2", account: "2010", label: "Owed on", side: "credit", amountMinor: 100_00, sealed: true },
  { id: "3", account: "4010", label: "Fee earned", side: "credit", amountMinor: 20_00, sealed: true }
];

const balanceOf = (legs: readonly { side: string; amountMinor: number }[]) => {
  let debitMinor = 0;
  let creditMinor = 0;
  for (const leg of legs) {
    if (leg.side === "debit") debitMinor += leg.amountMinor;
    else if (leg.side === "credit") creditMinor += leg.amountMinor;
  }
  return {
    debitMinor,
    creditMinor,
    deltaMinor: debitMinor - creditMinor,
    balanced: debitMinor === creditMinor
  };
};

describe("PostingFlow", () => {
  it("shows value leaving one side and arriving on the other", () => {
    const markup = renderToStaticMarkup(
      <PostingFlow legs={LEGS} currency="ZAR" balance={balanceOf(LEGS)} locale="en" />
    );
    for (const leg of LEGS) {
      expect(markup).toContain(leg.account);
      expect(markup).toContain(leg.label);
    }
    // The amount travelling, and both totals, formatted once.
    expect(markup).toContain("120.00");
    expect(markup).toContain("100.00");
    expect(markup).toContain("20.00");
  });

  it("states that debits equal credits when the ledger says they do", () => {
    const markup = renderToStaticMarkup(
      <PostingFlow legs={LEGS} currency="ZAR" balance={balanceOf(LEGS)} locale="en" />
    );
    expect(markup).toContain("Both sides agree");
    expect(markup).not.toContain('role="alert"');
  });

  it("alerts rather than claim a balance that does not hold", () => {
    const bad = [...LEGS.slice(0, 2)];
    const markup = renderToStaticMarkup(
      <PostingFlow legs={bad} currency="ZAR" balance={balanceOf(bad)} locale="en" />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Both sides agree");
    // The discrepancy is named, signed, in money.
    expect(markup).toContain("+ZAR");
    expect(markup).toContain("20.00");
  });

  it("will not restate a balance its own legs contradict", () => {
    // A ledger total that disagrees with the lines on screen is the one thing a
    // diagram must never smooth over (docs/19 §11).
    const markup = renderToStaticMarkup(
      <PostingFlow
        legs={LEGS.slice(0, 2)}
        currency="ZAR"
        balance={{ debitMinor: 120_00, creditMinor: 120_00, deltaMinor: 0, balanced: true }}
        locale="en"
      />
    );
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Both sides agree");
  });

  it("counts a line with an unrecognised side as a discrepancy", () => {
    const legs = [{ id: "1", account: "1010", side: "sideways", amountMinor: 100_00 }];
    const markup = renderToStaticMarkup(
      <PostingFlow legs={legs} currency="ZAR" balance={balanceOf(legs)} locale="en" />
    );
    expect(markup).toContain('role="alert"');
  });

  it("stacks the two sides at phone width instead of scrolling sideways", () => {
    const markup = renderToStaticMarkup(
      <PostingFlow legs={LEGS} currency="ZAR" balance={balanceOf(LEGS)} locale="en" />
    );
    expect(markup).toMatch(/class="[^"]*flex-col/);
    expect(markup).toMatch(/sm:flex-row/);
    expect(markup).not.toMatch(/overflow-x/);
  });

  it("carries no information in movement", () => {
    const markup = renderToStaticMarkup(
      <PostingFlow legs={LEGS} currency="ZAR" balance={balanceOf(LEGS)} locale="en" />
    );
    for (const match of markup.matchAll(/[\w:-]*animate-[\w-]+/g)) {
      expect(match[0]).toMatch(/^motion-safe:/);
    }
  });

  it("names each side with the caller's own words when the flow is not a posting", () => {
    const legs = [
      { id: "g", account: "gross", side: "debit", amountMinor: 500_00 },
      { id: "n", account: "net", side: "credit", amountMinor: 500_00 }
    ];
    const markup = renderToStaticMarkup(
      <PostingFlow
        legs={legs}
        currency="ZAR"
        balance={balanceOf(legs)}
        fromLabel="Earned"
        toLabel="Payable"
        locale="en"
      />
    );
    expect(markup).toContain('aria-label="Earned"');
    expect(markup).toContain('aria-label="Payable"');
    expect(markup).not.toContain("Debits");
  });
});
