import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  LANES,
  WIP_WARN,
  action,
  byUrgency,
  flagOf,
  isLate,
  labelsIn,
  laneViews,
  phrase,
  type BoardCase
} from "./axis-board";

// The board's only job is to be honest about depth and order: a WIP number that
// counts the page instead of the pile, or a lane that buries the overdue card
// under a fresh one, actively misleads. And the board must not learn to write
// workflow state — the assign-only reducer is pinned here on purpose.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null; key: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: new Headers(init.headers).get("idempotency-key")
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/board", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const NOW = 1_770_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const card = (over: Partial<BoardCase> = {}): BoardCase => ({
  id: "case_1",
  ref: "C-0001",
  kind: "quote",
  status: "review",
  priority: "normal",
  ownerRef: null,
  valueMinor: 250_000,
  currency: "AED",
  slaDueAt: NOW + 7 * DAY,
  createdAt: NOW - DAY,
  ...over
});

describe("LANES", () => {
  it("is the pipeline in working order, with cancelled off the board", () => {
    expect([...LANES]).toEqual([
      "intake",
      "quoting",
      "awaiting_docs",
      "review",
      "approval",
      "issued",
      "failed"
    ]);
    expect(LANES).not.toContain("cancelled");
  });
});

describe("labelsIn", () => {
  it("translates every key, and every lane, into Arabic", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      ...LANES.map((lane) => `lane.${lane}`),
      "wip.count",
      "wip.congested",
      "overflow",
      "unassigned",
      "sev.breach",
      "sev.due",
      "sev.urgent",
      "readonly.title",
      "readonly.reason",
      "readonly.action",
      "empty.title",
      "empty.body",
      "assign.title",
      "assign.intro",
      "assign.case",
      "assign.owner",
      "assign.submit",
      "done.assign",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "problem.bad_intent",
      "problem.missing_owner"
    ];

    for (const key of keys) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("interpolates the lane depth and the limit it passed", () => {
    expect(labelsIn("en")("wip.congested", { open: "20", limit: "12" })).toContain("20");
    expect(labelsIn("ar")("wip.congested", { open: "20", limit: "12" })).toContain("12");
  });
});

describe("laneViews", () => {
  it("files each case under its own status and leaves other lanes empty", () => {
    const views = laneViews([card({ status: "intake" }), card({ id: "b", status: "approval" })], NOW);
    const filled = views.filter((v) => v.cards.length).map((v) => v.lane);
    expect(filled).toEqual(["intake", "approval"]);
  });

  it("takes the lane depth from the API count, not from the page it could fit", () => {
    const views = laneViews([card({ status: "intake" })], NOW, { intake: 137 });
    const intake = views.find((v) => v.lane === "intake");
    expect(intake?.open).toBe(137);
    expect(intake?.cards).toHaveLength(1);
  });

  it("falls back to the cards it has when no count came back", () => {
    const views = laneViews([card({ status: "intake" }), card({ id: "b", status: "intake" })], NOW);
    expect(views.find((v) => v.lane === "intake")?.open).toBe(2);
  });

  it("flags congestion strictly above the limit, never at it", () => {
    const at = laneViews([], NOW, { review: WIP_WARN });
    const over = laneViews([], NOW, { review: WIP_WARN + 1 });
    expect(at.find((v) => v.lane === "review")?.congested).toBe(false);
    expect(over.find((v) => v.lane === "review")?.congested).toBe(true);
  });

  it("puts the overdue card at the top of its lane whatever its age", () => {
    const cases = [
      card({ id: "fresh", status: "review", slaDueAt: NOW + DAY, createdAt: NOW - 10 * DAY }),
      card({ id: "late", status: "review", slaDueAt: NOW - HOUR, createdAt: NOW - 60_000 })
    ];
    expect(laneViews(cases, NOW).find((v) => v.lane === "review")?.cards.map((c) => c.id)).toEqual([
      "late",
      "fresh"
    ]);
  });
});

describe("byUrgency", () => {
  it("sorts by lateness, then deadline, then age", () => {
    const rows = [
      card({ id: "no-date", slaDueAt: null, createdAt: NOW - 30 * DAY }),
      card({ id: "soon", slaDueAt: NOW + HOUR }),
      card({ id: "late-b", slaDueAt: NOW - HOUR }),
      card({ id: "late-a", slaDueAt: NOW - DAY })
    ];
    expect([...rows].sort(byUrgency(NOW)).map((r) => r.id)).toEqual([
      "late-a",
      "late-b",
      "soon",
      "no-date"
    ]);
  });
});

describe("isLate / flagOf", () => {
  it("treats a missing deadline as not late rather than as the epoch", () => {
    expect(isLate({ slaDueAt: null }, NOW)).toBe(false);
    expect(isLate({}, NOW)).toBe(false);
  });

  it("shouts overdue over urgent, and shows nothing for a healthy card", () => {
    expect(flagOf(card({ priority: "urgent", slaDueAt: NOW - 1 }), NOW)?.key).toBe("sev.breach");
    expect(flagOf(card({ priority: "urgent", slaDueAt: NOW + 30 * DAY }), NOW)?.key).toBe("sev.urgent");
    expect(flagOf(card({ slaDueAt: NOW + HOUR }), NOW)?.key).toBe("sev.due");
    expect(flagOf(card({ slaDueAt: NOW + 30 * DAY }), NOW)).toBeNull();
  });
});

describe("assign", () => {
  it("patches the owner and nothing else, with an idempotency key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "assign");
    form.set("caseId", "case_4");
    form.set("ownerRef", "user:7");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/case_4");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toBe(JSON.stringify({ ownerRef: "user:7" }));
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ problem: null, done: "assign" });
  });

  it("refuses a missing owner without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "assign");
    form.set("caseId", "case_4");

    expect((await action(args(form))).problem?.code).toBe("missing_owner");
    expect(calls).toHaveLength(0);
  });

  it("reports an approval gate instead of claiming the case moved", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "axis.case_issue"
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const form = new FormData();
    form.set("intent", "assign");
    form.set("caseId", "case_4");
    form.set("ownerRef", "user:7");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("the board never writes workflow state", () => {
  // The board deliberately has no transition intent: `PATCH status` from a
  // column header would move a case with no state machine and no approval. If
  // this test starts failing, a transition endpoint should have arrived first.
  it("rejects a status move as an unknown intent and issues no request", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    for (const intent of ["transition", "move", "set-status"]) {
      const form = new FormData();
      form.set("intent", intent);
      form.set("caseId", "case_4");
      form.set("status", "issued");

      const result = await action(args(form));

      expect(result.problem?.code).toBe("bad_intent");
      expect(result.problem?.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "bad_intent", status: 400, code: "bad_intent" }, l).title).toBe(
      l("problem.bad_intent")
    );
    expect(phrase({ title: "conflict", status: 409, code: "version" }, l).title).toBe("conflict");
  });
});
