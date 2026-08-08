import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  STUCK_CASE_STATUSES,
  action,
  ageIn,
  bySeverity,
  labelsIn,
  phrase,
  severityOf,
  type CaseRow
} from "./axis-exceptions";

// The exception queue's whole claim is "worst first". If the ordering or the
// severity rule is wrong the screen is worse than no screen: it tells an
// operator the breached case is fine. Those two functions and the two writes
// are what this file pins.

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
    request: new Request("https://web.test/axis/exceptions", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const NOW = 1_770_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const kase = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: "case_1",
  ref: "C-0001",
  kind: "quote",
  status: "review",
  priority: "normal",
  ownerRef: null,
  slaDueAt: NOW + 7 * DAY,
  createdAt: NOW - DAY,
  ...over
});

describe("labelsIn", () => {
  it("translates every English key into Arabic, none of it left in English", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      "bucket.cases",
      "bucket.documents",
      "bucket.tasks",
      "bucket.escrow",
      "bucket.complaints",
      "stat.total",
      "stat.breached",
      "stat.urgent",
      "stat.oldest",
      "sev.breach",
      "sev.urgent",
      "sev.due",
      "sev.normal",
      "unassigned",
      "empty.title",
      "empty.body",
      "denied.title",
      "denied.body",
      "claim.title",
      "claim.intro",
      "claim.case",
      "claim.owner",
      "claim.submit",
      "done.claim",
      "done.unblock",
      "unblock.submit",
      "days",
      "hours",
      "minutes",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "problem.bad_intent",
      "problem.missing_case",
      "problem.missing_task"
    ];

    for (const key of keys) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("interpolates the policy that gated a write, in both locales", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.case_issue" })).toContain("axis.case_issue");
    expect(labelsIn("ar")("approvalBody", { policy: "axis.case_issue" })).toContain("axis.case_issue");
  });

  it("falls back to English for an unknown locale rather than showing a key", () => {
    expect(labelsIn("fr")("title")).toBe(labelsIn("en")("title"));
  });
});

describe("severityOf", () => {
  it("calls a passed deadline a breach whatever the priority says", () => {
    expect(severityOf({ priority: "low", slaDueAt: NOW - 1 }, NOW)).toBe("breach");
  });

  it("ranks an urgent case above one merely due soon", () => {
    expect(severityOf({ priority: "urgent", slaDueAt: NOW + 30 * DAY }, NOW)).toBe("urgent");
    expect(severityOf({ priority: "normal", slaDueAt: NOW + HOUR }, NOW)).toBe("due");
  });

  it("treats a case with no deadline as waiting, not as overdue", () => {
    expect(severityOf({ priority: "normal", slaDueAt: null }, NOW)).toBe("normal");
    expect(severityOf({ priority: "normal" }, NOW)).toBe("normal");
  });
});

describe("bySeverity", () => {
  it("puts the breached case first even when it was created last", () => {
    const rows = [
      kase({ id: "waiting" }),
      kase({ id: "urgent", priority: "urgent" }),
      kase({ id: "breached", slaDueAt: NOW - HOUR, createdAt: NOW - 60_000 }),
      kase({ id: "due", slaDueAt: NOW + HOUR })
    ];

    expect([...rows].sort(bySeverity(NOW)).map((r) => r.id)).toEqual([
      "breached",
      "urgent",
      "due",
      "waiting"
    ]);
  });

  it("breaks a tie by the earlier deadline, then by age", () => {
    const rows = [
      kase({ id: "later", slaDueAt: NOW - HOUR }),
      kase({ id: "earlier", slaDueAt: NOW - DAY }),
      kase({ id: "same-a", slaDueAt: NOW - HOUR, createdAt: NOW - 10 * DAY })
    ];

    expect([...rows].sort(bySeverity(NOW)).map((r) => r.id)).toEqual(["earlier", "same-a", "later"]);
  });

  it("sorts a case with no deadline last without treating null as zero", () => {
    const rows = [kase({ id: "none", slaDueAt: null }), kase({ id: "dated", slaDueAt: NOW + DAY })];
    expect([...rows].sort(bySeverity(NOW)).map((r) => r.id)).toEqual(["dated", "none"]);
  });
});

describe("ageIn", () => {
  const l = labelsIn("en");

  it("reports one coarse unit and never a negative age", () => {
    expect(ageIn(3 * DAY, l)).toBe("3d");
    expect(ageIn(5 * HOUR, l)).toBe("5h");
    expect(ageIn(90_000, l)).toBe("1m");
    expect(ageIn(-DAY, l)).toBe("0m");
  });

  it("carries the locale's own unit letters", () => {
    expect(ageIn(3 * DAY, labelsIn("ar"))).toBe("3ي");
  });
});

describe("claim", () => {
  it("patches only the owner, with an idempotency key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "claim");
    form.set("caseId", "case_9");
    form.set("ownerRef", "staff_7");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/case_9");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toBe(JSON.stringify({ ownerRef: "staff_7" }));
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ problem: null, done: "claim" });
  });

  it("refuses a blank owner without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "claim");
    form.set("caseId", "case_9");
    form.set("ownerRef", "   ");

    expect((await action(args(form))).problem?.code).toBe("missing_case");
    expect(calls).toHaveLength(0);
  });

  it("surfaces an approval gate as a problem instead of pretending it saved", async () => {
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
    form.set("intent", "claim");
    form.set("caseId", "case_9");
    form.set("ownerRef", "staff_7");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("unblock", () => {
  it("moves a blocked task back to open", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "unblock");
    form.set("taskId", "task_3");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/tasks/task_3");
    expect(calls[0]?.body).toBe(JSON.stringify({ state: "open" }));
    expect(result.done).toBe("unblock");
  });

  it("refuses a submission with no task named", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "unblock");

    expect((await action(args(form))).problem?.code).toBe("missing_task");
    expect(calls).toHaveLength(0);
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "delete-everything");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("replaces a code this screen knows with its own sentence", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "bad_intent", status: 400, code: "bad_intent" }, l).title).toBe(
      l("problem.bad_intent")
    );
  });

  it("leaves an unknown code with the API's own title, never a raw key", () => {
    const out = phrase({ title: "rate limited", status: 429, code: "too_many" }, labelsIn("en"));
    expect(out.title).toBe("rate limited");
  });
});

describe("the stuck statuses", () => {
  it("are the ones waiting on a person, and exclude work in flight", () => {
    expect([...STUCK_CASE_STATUSES]).toEqual(["failed", "approval", "awaiting_docs", "review"]);
    expect(STUCK_CASE_STATUSES).not.toContain("intake");
    expect(STUCK_CASE_STATUSES).not.toContain("quoting");
  });
});
