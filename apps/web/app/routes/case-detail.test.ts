import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, STATES, action, labelsIn } from "./case-detail";

// The work item's two transitions are the only writes: move the state machine,
// or mark one document verified. Both are the API's own state changes, so the
// reducer only guards the inputs and passes a refusal through untouched.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/cases/cas_1/detail", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "cas_1" }
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  body.set("idempotencyKey", "key-1");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

const ok = () =>
  new Response(JSON.stringify({ id: "cas_1" }), { status: 200, headers: { "content-type": "application/json" } });

describe("labelsIn", () => {
  it("answers every key in both languages, and never with the key itself", () => {
    for (const key of Object.keys(LABELS.en!)) {
      expect(LABELS.ar![key], key).toBeTruthy();
      for (const locale of ["en", "ar"]) expect(labelsIn(locale)(key), `${locale}:${key}`).not.toBe(key);
    }
    expect(Object.keys(LABELS.ar!).sort()).toEqual(Object.keys(LABELS.en!).sort());
  });

  it("keeps the Arabic distinct from the English", () => {
    for (const [key, value] of Object.entries(LABELS.en!)) expect(LABELS.ar![key], key).not.toBe(value);
  });

  it("names every state it offers to move to, in both languages", () => {
    for (const state of STATES) {
      for (const locale of ["en", "ar"]) {
        expect(labelsIn(locale)(`status.${state}`), `${locale}:${state}`).not.toBe(`status.${state}`);
      }
    }
  });

  it("answers the chrome Gate needs, with the rule interpolated", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.case_transition" })).toContain("axis.case_transition");
  });
});

describe("action: move", () => {
  it("patches only the status", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "move", status: "review" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/cas_1");
    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: "review" });
    expect(result.done).toBe("moved");
  });

  it("refuses a state the machine does not have", async () => {
    const calls = stubFetch(ok());
    for (const status of ["", "done", "INTAKE"]) {
      const result = await action(args(form({ intent: "move", status })));
      expect(result.error, status).toBe("stateRequired");
    }
    expect(calls).toHaveLength(0);
  });

  it("surfaces a refusal rather than claiming the item moved", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "move", status: "issued" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});

describe("action: verify", () => {
  it("posts the verify step for one document", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));

    const result = await action(args(form({ intent: "verify", documentId: "doc_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/documents/doc_1/verify");
    expect(calls[0]?.method).toBe("POST");
    expect(result.done).toBe("verified");
  });

  it("refuses a missing document without calling anything", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));

    const result = await action(args(form({ intent: "verify", documentId: "  " })));

    expect(result.error).toBe("documentRequired");
    expect(calls).toHaveLength(0);
  });
});

describe("action: copilot", () => {
  it("asks the case copilot and returns its answer", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ answer: "It is worth 5000 AED.", confidence: 0.95, mismatches: [], auditId: "aud_1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "copilot", question: "What is this case worth?", locale: "en" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/cases/cas_1/copilot");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ question: "What is this case worth?", locale: "en" });
    expect(result.done).toBe("answered");
    expect(result.answer).toBe("It is worth 5000 AED.");
  });

  it("refuses an empty question without calling anything", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "copilot", question: "  ", locale: "en" })));

    expect(result.error).toBe("questionRequired");
    expect(calls).toHaveLength(0);
  });
});

describe("action: anything else", () => {
  it("rejects an intent it does not implement", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "close" })));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("action: export", () => {
  it("requests an internal evidence bundle scoped to this case", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "evb_1", state: "ready" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "export" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/compliance/evidence-bundles/export");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ purpose: "internal", subjectRef: "cas_1" });
    expect(result.done).toBe("exported");
    expect(result.bundleId).toBe("evb_1");
  });

  it("surfaces a refusal rather than claiming the bundle exists", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "export" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});
