import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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
  loader,
  phrase,
  priorityScore,
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

function loaderArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/board"),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetchByUrl(replies: Array<[string, Response]>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    const match = replies.find(([suffix]) => url.includes(suffix));
    return Promise.resolve(match ? match[1].clone() : new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
  return calls;
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
  riskScore: null,
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

  it("uses a lane's own tenant override instead of WIP_WARN, and leaves other lanes on the default", () => {
    const views = laneViews([], NOW, { quoting: WIP_WARN + 5, review: WIP_WARN + 5 }, { quoting: 3 });
    expect(views.find((v) => v.lane === "quoting")).toMatchObject({ warnAt: 3, congested: true });
    expect(views.find((v) => v.lane === "review")).toMatchObject({ warnAt: WIP_WARN, congested: true });
  });

  it("reports the resolved threshold on every lane even without an override", () => {
    const views = laneViews([], NOW);
    expect(views.every((v) => v.warnAt === WIP_WARN)).toBe(true);
  });
});

describe("priorityScore", () => {
  it("weights value, risk and SLA into one 0..1-ish score", () => {
    const rich = card({ valueMinor: 5_000_00, riskScore: 100, slaDueAt: NOW - HOUR });
    const poor = card({ valueMinor: 0, riskScore: 0, slaDueAt: NOW + 30 * DAY });
    expect(priorityScore(rich, NOW)).toBeGreaterThan(priorityScore(poor, NOW));
  });

  it("scores an overdue case's SLA term as fully saturated", () => {
    const barelyLate = card({ slaDueAt: NOW - 1 });
    const veryLate = card({ slaDueAt: NOW - 30 * DAY });
    expect(priorityScore(barelyLate, NOW)).toBe(priorityScore(veryLate, NOW));
  });

  it("treats a missing deadline as mid-urgency, not zero", () => {
    const noDate = card({ slaDueAt: null });
    const distant = card({ slaDueAt: NOW + 30 * DAY });
    expect(priorityScore(noDate, NOW)).toBeGreaterThan(priorityScore(distant, NOW));
  });
});

describe("byUrgency", () => {
  it("sorts by priority score, then deadline, then age", () => {
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

  it("puts a higher-value, higher-risk case ahead of a merely-later one at equal SLA", () => {
    const rows = [
      card({ id: "low", valueMinor: 0, riskScore: 0, slaDueAt: NOW + DAY }),
      card({ id: "high", valueMinor: 5_000_00, riskScore: 100, slaDueAt: NOW + DAY })
    ];
    expect([...rows].sort(byUrgency(NOW)).map((r) => r.id)).toEqual(["high", "low"]);
  });

  it("breaks an exact priority tie on the earlier deadline, then the older case", () => {
    const rows = [
      card({ id: "b", slaDueAt: NOW - HOUR, createdAt: NOW - DAY }),
      card({ id: "a", slaDueAt: NOW - 2 * HOUR, createdAt: NOW - 2 * DAY })
    ];
    expect([...rows].sort(byUrgency(NOW)).map((r) => r.id)).toEqual(["a", "b"]);
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

describe("loader", () => {
  it("reads the tenant's per-lane WIP override from the axis.board ops policy", async () => {
    stubFetchByUrl([
      ["/v1/axis/ops-policies", json({ data: [{ valueJson: JSON.stringify({ wipWarn: { quoting: 3 } }) }] })]
    ]);

    const result = await loader(loaderArgs());

    expect(result.wipWarn).toEqual({ quoting: 3 });
  });

  it("falls back to no overrides when the policy row is missing, a 403, or malformed JSON", async () => {
    stubFetchByUrl([["/v1/axis/ops-policies", json({ data: [] })]]);
    expect((await loader(loaderArgs())).wipWarn).toEqual({});

    stubFetchByUrl([["/v1/axis/ops-policies", json({ title: "forbidden", status: 403 }, 403)]]);
    expect((await loader(loaderArgs())).wipWarn).toEqual({});

    stubFetchByUrl([["/v1/axis/ops-policies", json({ data: [{ valueJson: "not json" }] })]]);
    expect((await loader(loaderArgs())).wipWarn).toEqual({});
  });

  it("ignores non-numeric or unknown-lane entries in the policy's wipWarn map", async () => {
    stubFetchByUrl([
      [
        "/v1/axis/ops-policies",
        json({ data: [{ valueJson: JSON.stringify({ wipWarn: { quoting: "twelve", not_a_lane: 5, review: 8 } }) }] })
      ]
    ]);

    expect((await loader(loaderArgs())).wipWarn).toEqual({ review: 8 });
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

describe("transition", () => {
  it("posts to the case's transition endpoint with an idempotency key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "transition");
    form.set("caseId", "case_4");
    form.set("to", "review");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/case_4/transition");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ to: "review" }));
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ problem: null, done: "transition" });
  });

  it("refuses a transition with no target state and issues no request", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "transition");
    form.set("caseId", "case_4");

    expect((await action(args(form))).problem?.code).toBe("missing_target");
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
    form.set("intent", "transition");
    form.set("caseId", "case_4");
    form.set("to", "issued");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("the board never writes workflow state directly", () => {
  // The board's only ways to change a case are `assign` (owner) and
  // `transition` (state machine + approval gate, see axis-case-lifecycle.ts).
  // A free-form `PATCH status` from a column header would move a case with no
  // state machine and no approval — that path must stay refused.
  it("rejects a status move as an unknown intent and issues no request", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    for (const intent of ["move", "set-status"]) {
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
