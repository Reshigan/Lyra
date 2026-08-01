import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { action } from "./settings";

// The reset control has no body — it only needs to prove the intent reaches
// POST /v1/me/lens/reset and reports ok, or surfaces the API's problem as-is.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi(resetStatus = 200) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/v1/me/lens/reset")) {
      return Promise.resolve(
        resetStatus === 200
          ? new Response(JSON.stringify({ lens: { workspace: "axis" }, isDefault: true }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
          : new Response(JSON.stringify({ title: "only a user has a lens" }), {
              status: 400,
              headers: { "content-type": "application/json" }
            })
      );
    }
    const body = url.includes("/v1/me") ? { id: "usr_01", permissions: [], roles: [], tenant: { id: "t1" } } : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  return calls;
}

function args(intent: string): any {
  return {
    request: new Request("https://web.test/settings", {
      method: "POST",
      body: new URLSearchParams({ intent })
    }),
    params: {},
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("lens-reset intent", () => {
  it("calls POST /v1/me/lens/reset and reports ok", async () => {
    const calls = stubApi();
    const result = await action(args("lens-reset"));
    expect(result).toMatchObject({ intent: "lens-reset", ok: true });
    expect(calls.some((c) => c.url.includes("/v1/me/lens/reset") && c.method === "POST")).toBe(true);
  });

  it("surfaces the API's problem instead of throwing", async () => {
    stubApi(400);
    const result: any = await action(args("lens-reset"));
    expect(result.intent).toBe("lens-reset");
    expect(result.ok).toBeUndefined();
    expect(result.problem).toBeDefined();
  });
});
