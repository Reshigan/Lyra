import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  ROW_HEIGHT,
  flowFrom,
  flowHeight,
  headlineFor,
  labelsIn,
  layoutFlow,
  loader,
  worstBottleneck,
  type FlowEvent
} from "./axis-process-map";

// The map is process mining across every case, not one case's timeline
// (case-detail.tsx already tables that) — these tests pin the two arithmetic
// steps that turn raw axis_process_events rows into a flow diagram: tallying
// step-to-step transitions across cases, then laying the tally out.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

/** Replies keyed by the tail of the URL, because the loader hits /v1/me plus the events feed. */
function stubFetchByUrl(replies: Array<[string, Response]>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    const match = replies.find(([suffix]) => url.endsWith(suffix));
    return Promise.resolve(match ? match[1].clone() : new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function loaderArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/process-map"),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loader", () => {
  it("asks the process-events feed for no more than the backend's page limit", async () => {
    const calls = stubFetchByUrl([
      ["/v1/me", json({ actor: {}, permissions: ["axis:metrics:read"], roles: [], nav: [] })]
    ]);

    await loader(loaderArgs());

    const events = calls.find((c) => c.url.includes("/v1/axis/process-events"));
    expect(events?.url).toContain("limit=200");
    expect(events?.url).not.toContain("limit=2000");
  });
});

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

describe("worstBottleneck", () => {
  it("picks the transition with the highest average duration", () => {
    const links = [
      { from: "intake", to: "review", count: 2, avgMs: 250 },
      { from: "review", to: "issued", count: 1, avgMs: 900 }
    ];
    expect(worstBottleneck(links)).toEqual({ from: "review", to: "issued", count: 1, avgMs: 900 });
  });

  it("returns null when there are no links", () => {
    expect(worstBottleneck([])).toBeNull();
  });
});

describe("headlineFor", () => {
  const l = labelsIn("en");

  it("says nothing is recorded when the flow is empty", () => {
    expect(headlineFor({ nodes: [], links: [] }, l)).toBe(l("headline.empty"));
  });

  it("calls out the slowest transition when one exists", () => {
    const flow = flowFrom([
      { caseId: "c1", step: "intake", ts: 1, durationMs: 100 },
      { caseId: "c1", step: "review", ts: 2, durationMs: 900 }
    ]);
    expect(headlineFor(flow, l)).toBe(
      l("headline.bottleneck", { from: "Intake", to: "Review" })
    );
  });

  it("falls back to moving when steps exist but nothing pools", () => {
    const flow = { nodes: [{ step: "intake", rank: 0, total: 1 }], links: [] };
    expect(headlineFor(flow, l)).toBe(l("headline.moving"));
  });
});

describe("layoutFlow", () => {
  it("places later ranks further down and sets a row's nodes side by side without overlap", () => {
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

    // Sideways, ten ranks across 880px left every label overwriting its
    // neighbour; the flow runs down the page now.
    expect(review.y).toBeGreaterThan(intake.y);
    expect(escalated.y).toBe(review.y);
    expect(escalated.x).toBeGreaterThanOrEqual(review.x + review.width);
  });

  it("gives the canvas a row per rank so deep flows are not squeezed", () => {
    const flow = flowFrom([
      { caseId: "c1", step: "intake", ts: 1 },
      { caseId: "c1", step: "review", ts: 2 },
      { caseId: "c1", step: "bound", ts: 3 }
    ]);

    expect(flowHeight(flow)).toBe(3 * ROW_HEIGHT);
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
