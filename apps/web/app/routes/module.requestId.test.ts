import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { action } from "./module";

// docs/15-experience-excellence.md:129 checklist item 10 — every error state
// carries a trace_id + next step. `action()` here is the narrowing point: it
// takes the ApiError the API layer throws and hands the route only
// `error.problem`. If `x-request-id` doesn't ride along on that problem, the
// screen has nothing for support to look up (UX audit 2026-08-10, gap G6).

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRejectedCreate() {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ title: "Invalid", status: 400 }), {
        status: 400,
        headers: { "content-type": "application/json", "x-request-id": "req_g6" }
      })
    )
  );
}


function args(module: string, resource: string): any {
  return {
    request: new Request(`https://web.test/${module}/${resource}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "create", url: "https://hook.test", eventTypesJson: "[]" })
    }),
    params: { module, resource },
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("a rejected write keeps its request id", () => {
  it("carries x-request-id through to the rendered problem", async () => {
    stubRejectedCreate();
    const result = await action(args("admin", "webhooks"));

    expect(result.problem?.requestId).toBe("req_g6");
  });
});
