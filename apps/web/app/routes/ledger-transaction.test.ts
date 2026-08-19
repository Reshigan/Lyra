import { flowPlan } from "@lyra/ui";
import { describe, expect, it } from "vitest";
import { TXN_FLOW } from "./ledger-transaction";
import { TRANSITIONS, TXN_STATES } from "./ledger.shared";

// The diagram on the transaction screen is only ever as true as the machine it
// is handed. These pin it to the ledger's own machine (docs/19 §3) so a state
// cannot be drawn that the ledger would never enter, nor an edge it cannot take.

describe("TXN_FLOW", () => {
  it("is the ledger's machine by reference, not a second copy of it", () => {
    expect(TXN_FLOW.transitions).toBe(TRANSITIONS);
  });

  it("names no state outside the documented set", () => {
    for (const state of [...TXN_FLOW.spine, ...(TXN_FLOW.exits ?? [])]) {
      expect(TXN_STATES).toContain(state);
    }
  });

  it("is a spine of documented transitions, whole", () => {
    // `flowPlan` throws on an undocumented spine edge, so this both plans and
    // proves the happy path is one the ledger can actually walk.
    const plan = flowPlan(TXN_FLOW, [], "initiated");
    expect(plan.steps.map((step) => step.state)).toEqual([...TXN_FLOW.spine]);
    expect(plan.unknown).toEqual([]);
  });

  it("promises nothing further once a transaction has failed, been rejected or expired", () => {
    for (const state of TXN_FLOW.exits ?? []) {
      const plan = flowPlan(TXN_FLOW, [{ state }], state);
      expect(plan.steps.map((step) => step.state)).toEqual([state]);
    }
  });

  it("can draw every state the ledger can reach, on the spine or off it", () => {
    for (const state of TXN_STATES) {
      const plan = flowPlan(TXN_FLOW, [{ state }], state);
      expect(plan.steps.map((step) => step.state)).toContain(state);
      expect(plan.unknown).toEqual([]);
    }
  });
});
