import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action, loader } from "./signal-audience-value";

// The suggest-audience action is the one write this screen has: it hands a
// subject to POST /v1/signal/audiences/suggest and renders whatever pool the
// engine proposes. Nothing here re-derives audience value (signal.shared
// already owns that); these tests only cover the new action branch and the
// subject/whitespaceId context the loader now threads through from SCOUT.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...replies: Response[]) {
  const calls: Array<{ url: string; method: string; body: string | null; key: string | null }> = [];
  let at = 0;
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: headers.get("idempotency-key")
    });
    const reply = replies[Math.min(at, replies.length - 1)] ?? new Response(null, { status: 204 });
    at += 1;
    return Promise.resolve(reply.clone());
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/signal/audience-value", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const form = (fields: Record<string, string>): FormData => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
};

const SUGGESTION = {
  audienceId: "aud_1",
  proposal: {
    name: "High-intent renewers",
    summary: "Customers likely to renew within the window",
    demographics: [{ axis: "lsm", value: "7-8" }],
    reasons: [{ axis: "lsm", value: "7-8", reason: "Highest historical renewal rate", count: 420 }],
    lsm: [7, 8],
    rule: { all: [{ field: "lsm", op: "in", value: ["7", "8"] }] },
    estimatedReach: 420,
    confidence: 92
  },
  source: "ai",
  auditId: "aud_audit_1",
  shownCounts: [
    { axis: "lsm", value: "7-8", count: 420 },
    { axis: "lsm", value: "5-6", count: 900 }
  ]
};

describe("audience-value loader", () => {
  function stubLoader() {
    vi.stubGlobal("fetch", () => Promise.resolve(json({ data: [] })));
  }

  function loadArgs(qs: string): LoaderFunctionArgs {
    return {
      request: new Request(`https://web.test/signal/audience-value${qs}`),
      context: { get: () => ({ env, ctx: null }) },
      params: {}
    } as unknown as LoaderFunctionArgs;
  }

  it("threads the subject and whitespaceId SCOUT hands off, in the query string", async () => {
    stubLoader();
    const loaded = await loader(loadArgs("?subject=Fleet+renewals&whitespaceId=ws_1"));
    expect(loaded.subject).toBe("Fleet renewals");
    expect(loaded.whitespaceId).toBe("ws_1");
  });

  it("defaults to empty context and still mints a fresh idempotency key", async () => {
    stubLoader();
    const loaded = await loader(loadArgs(""));
    expect(loaded.subject).toBe("");
    expect(loaded.whitespaceId).toBe("");
    expect(loaded.key.length).toBeGreaterThan(0);
  });
});

describe("suggest-audience action", () => {
  it("refuses an empty or oversized subject before calling the API", async () => {
    const calls = stubFetch(json(SUGGESTION));
    const empty = await action(args(form({ intent: "suggest_audience", subject: "  " })));
    expect(empty.problem?.code).toBe("subject_required");

    const oversized = await action(args(form({ intent: "suggest_audience", subject: "x".repeat(201) })));
    expect(oversized.problem?.code).toBe("subject_required");
    expect(calls).toHaveLength(0);
  });

  it("suggests a pool for a valid subject", async () => {
    const calls = stubFetch(json(SUGGESTION));
    const result = await action(
      args(form({ intent: "suggest_audience", subject: "Fleet renewals", whitespaceId: "ws_1", key: "key-1" }))
    );
    expect(result.problem).toBeNull();
    expect(result.suggestion?.proposal.name).toBe("High-intent renewers");
    expect(calls[0]?.url).toContain("/v1/signal/audiences/suggest");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBe("key-1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ subject: "Fleet renewals" });
  });

  it("mints an idempotency key when the form did not carry one", async () => {
    const calls = stubFetch(json(SUGGESTION));
    await action(args(form({ intent: "suggest_audience", subject: "Fleet renewals" })));
    expect(calls[0]?.key?.length ?? 0).toBeGreaterThan(0);
  });

  it("passes a problem the API returns straight through", async () => {
    stubFetch(json({ title: "no customer attributes", status: 409, code: "conflict" }, 409));
    const result = await action(args(form({ intent: "suggest_audience", subject: "Fleet renewals" })));
    expect(result.problem?.status).toBe(409);
    expect(result.suggestion).toBeNull();
  });

  it("refuses anything but suggest_audience", async () => {
    const calls = stubFetch(json(SUGGESTION));
    const result = await action(args(form({ intent: "delete" })));
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});
