import { describe, expect, it } from "vitest";
import { flowFrom, layoutFlow, type FlowEvent } from "./axis-process-map";

// The map is process mining across every case, not one case's timeline
// (case-detail.tsx already tables that) — these tests pin the two arithmetic
// steps that turn raw axis_process_events rows into a flow diagram: tallying
// step-to-step transitions across cases, then laying the tally out.

describe("flowFrom", () => {
  it("ranks steps by first appearance and tallies transitions across cases", () => {
    const events: FlowEvent[] = [
      { caseId: "c1", step: "intake", ts: 1, durationMs: 100 },
      { caseId: "c1", step: "review", ts: 2, durationMs: 200 },
      { caseId: "c2", step: "intake", ts: 1, durationMs: 50 },
      { caseId: "c2", step: "review", ts: 2, durationMs: 300 },
      { caseId: "c2", step: "issued", ts: 3, durationMs: 10 }
    ];

    const flow = flowFrom(events);

    expect(flow.nodes).toEqual([
      { step: "intake", rank: 0, total: 2 },
      { step: "review", rank: 1, total: 2 },
      { step: "issued", rank: 2, total: 1 }
    ]);
    expect(flow.links).toEqual([
      { from: "intake", to: "review", count: 2, avgMs: 250 },
      { from: "review", to: "issued", count: 1, avgMs: 10 }
    ]);
  });

  it("orders a case's events by time, not by arrival order", () => {
    const events: FlowEvent[] = [
      { caseId: "c1", step: "review", ts: 2 },
      { caseId: "c1", step: "intake", ts: 1 }
    ];

    expect(flowFrom(events).links).toEqual([{ from: "intake", to: "review", count: 1, avgMs: 0 }]);
  });

  it("gives a lone-step case no links", () => {
    const flow = flowFrom([{ caseId: "c1", step: "intake", ts: 1 }]);
    expect(flow.links).toEqual([]);
    expect(flow.nodes).toEqual([{ step: "intake", rank: 0, total: 1 }]);
  });
});

describe("layoutFlow", () => {
  it("places later ranks further along and stacks a column's nodes without overlap", () => {
    const flow = flowFrom([
      { caseId: "c1", step: "intake", ts: 1 },
      { caseId: "c1", step: "review", ts: 2 },
      { caseId: "c2", step: "intake", ts: 1 },
      { caseId: "c2", step: "escalated", ts: 2 }
    ]);

    const laid = layoutFlow(flow, 800, 400);
    const intake = laid.nodes.find((n) => n.step === "intake")!;
    const review = laid.nodes.find((n) => n.step === "review")!;
    const escalated = laid.nodes.find((n) => n.step === "escalated")!;

    expect(review.x).toBeGreaterThan(intake.x);
    expect(escalated.x).toBe(review.x);
    expect(escalated.y).toBeGreaterThanOrEqual(review.y + review.height);
  });

  it("drops a link whose node is missing rather than drawing a dangling path", () => {
    const laid = layoutFlow(
      { nodes: [{ step: "a", rank: 0, total: 1 }], links: [{ from: "a", to: "ghost", count: 1, avgMs: 0 }] },
      400,
      200
    );

    expect(laid.links[0]!.path).toBe("");
    expect(laid.links[0]!.width).toBe(0);
  });
});
