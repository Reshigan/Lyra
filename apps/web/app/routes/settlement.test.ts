import { flowPlan } from "@lyra/ui";
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_FLOW,
  queueHeadline,
  settlementTone,
  settlementVisits,
  type QueueGroup,
  type Settlement
} from "./settlement";

const l = (key: string, vars?: Record<string, string>): string =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

const group = (state: string, currency: string, count: number): QueueGroup => ({
  state,
  currency,
  count,
  netMinor: 0,
});

describe("queueHeadline", () => {
  it("falls back to the static intro when the queue is empty", () => {
    expect(queueHeadline([], l)).toBe("intro");
  });

  it("counts a queue with nothing awaiting a second signature", () => {
    expect(queueHeadline([group("drafted", "ZAR", 3)], l)).toBe("queueHeadline.count:3");
  });

  it("calls out settlements awaiting a second signature", () => {
    expect(queueHeadline([group("drafted", "ZAR", 2), group("approved", "ZAR", 1)], l)).toBe(
      "queueHeadline.awaiting:3,1"
    );
  });

  it("sums counts across currencies", () => {
    expect(
      queueHeadline([group("approved", "ZAR", 2), group("approved", "AED", 1)], l)
    ).toBe("queueHeadline.awaiting:3,3");
  });
});

/* ----------------------------------------------------------- SETTLEMENT_FLOW */

// apps/api/src/engines/settlement.ts is the machine: a draft approves or is
// disputed, an approved settlement pays or is disputed, a dispute reopens as a
// draft, and paid is the end. The diagram may show that and nothing else.
const ENGINE = {
  draft: ["approved", "disputed"],
  approved: ["paid", "disputed"],
  paid: [],
  disputed: ["draft"]
};

const settlement = (state: string, over: Partial<Settlement> = {}): Settlement => ({
  id: "s1",
  counterpartyKind: "partner",
  counterpartyRef: "channel:acme",
  period: "2026-06",
  grossMinor: 500_00,
  adjustmentsMinor: -50_00,
  netMinor: 450_00,
  currency: "ZAR",
  statementFileId: null,
  state,
  approvedBy: "user:dana",
  txnId: null,
  createdAt: Date.parse("2026-07-01T08:00:00Z"),
  updatedAt: Date.parse("2026-07-02T09:00:00Z"),
  ...over
});

describe("SETTLEMENT_FLOW", () => {
  it("is the engine's machine, transition for transition", () => {
    expect(SETTLEMENT_FLOW.transitions).toEqual(ENGINE);
  });

  it("walks draft to paid as its spine, with dispute as the way out", () => {
    const plan = flowPlan(SETTLEMENT_FLOW, [], "draft");
    expect(plan.steps.map((step) => step.state)).toEqual(["draft", "approved", "paid"]);
    expect(SETTLEMENT_FLOW.exits).toEqual(["disputed"]);
  });
});

describe("settlementVisits", () => {
  it("timestamps a fresh draft from when it was drafted", () => {
    const s = settlement("draft");
    expect(settlementVisits(s)).toEqual([
      { state: "draft", at: s.createdAt, tone: settlementTone("draft") }
    ]);
  });

  it("shows the approval a paid settlement must have passed through", () => {
    expect(settlementVisits(settlement("paid")).map((visit) => visit.state)).toEqual([
      "draft",
      "approved",
      "paid"
    ]);
  });

  it("credits the approver, and only from the approval onwards", () => {
    const visits = settlementVisits(settlement("approved"));
    expect(visits.map((visit) => visit.actor)).toEqual([undefined, "user:dana"]);
  });

  it("dates the current state from the last change, not the drafting", () => {
    const s = settlement("approved");
    expect(settlementVisits(s).at(-1)?.at).toBe(s.updatedAt);
  });

  it("leaves the spine for a state that is not on it", () => {
    const visits = settlementVisits(settlement("disputed"));
    expect(visits.map((visit) => visit.state)).toEqual(["draft", "disputed"]);
    // And the plan that draws it still refuses to invent anything.
    expect(flowPlan(SETTLEMENT_FLOW, visits, "disputed").unknown).toEqual([]);
  });
});
