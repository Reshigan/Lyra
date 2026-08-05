import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action } from "./axis-dev";

// docs/20 developer console sandbox. The action is a thin pass-through to
// /v1/axis/dev/extract-sample — these tests hold the request/response shape,
// not the extraction logic itself (that's apps/api/src/axis-dev.test.ts).

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
    request: new Request("https://web.test/axis/dev", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("action", () => {
  it("sends the sample to the extraction endpoint and returns the parsed fields", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ values: { idNumber: "784-1" }, confidence: 92, model: "gpt" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(
      args(form({ docType: "eid", locale: "en", rawText: "ID Number: 784-1" }))
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/dev/extract-sample");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ docType: "eid", locale: "en", rawText: "ID Number: 784-1" });
    expect(result.result).toEqual({ values: { idNumber: "784-1" }, confidence: 92, model: "gpt" });
    expect(result.problem).toBeNull();
  });

  it("surfaces a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ docType: "eid", locale: "en", rawText: "text" })));

    expect(result.problem?.status).toBe(403);
    expect(result.result).toBeNull();
  });
});
