import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action, autonomyRung } from "./ai-console";

// docs/12 §4: "Kill switches: per-agent, per-module, per-tenant, global — all
// one click, all logged". The per-agent tier is covered next door in
// ai-budget.test.ts; these are the wider two the console can throw, and the one
// thing that must never happen to them — a pause that silently posts nothing
// because the form had no agent key attached.

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
    request: new Request("https://web.test/admin/ai", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

describe("tenant and module kill switches", () => {
  it("pauses the whole tenant with the typed reason", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "ai-pause");
    form.set("reason", "vendor incident");

    const result = await action(args(form));

    expect(result.problem).toBeNull();
    expect(calls[0]?.url).toBe("https://api.test/v1/ai/pause");
    expect(calls[0]?.body).toBe(JSON.stringify({ reason: "vendor incident" }));
  });

  it("scopes the pause to one module when one is chosen", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "ai-pause");
    form.set("module", "scout");
    form.set("reason", "citing a retired price list");

    await action(args(form));

    expect(calls[0]?.body).toBe(
      JSON.stringify({ module: "scout", reason: "citing a retired price list" })
    );
  });

  it("resumes a module without demanding a reason", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "ai-resume");
    form.set("module", "scout");

    await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/ai/resume");
    expect(calls[0]?.body).toBe(JSON.stringify({ module: "scout" }));
  });

  it("reports a refused pause as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );
    const form = new FormData();
    form.set("intent", "ai-pause");
    form.set("reason", "not mine to throw");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(403);
  });

  it("still refuses an agent-scoped intent that arrives without an agent key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "pause");
    form.set("reason", "no key attached");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

// Nine of the ten seeded agents store `suggest_only`, a spelling on no ladder:
// the Autonomy badge printed the raw key and the picker under it opened blank.
describe("autonomyRung", () => {
  it("keeps a level that is already a rung", () => {
    expect(autonomyRung("act_with_approval")).toBe("act_with_approval");
  });

  it("maps the spellings written before the ladder was declared", () => {
    expect(autonomyRung("suggest_only")).toBe("suggest");
    expect(autonomyRung("act")).toBe("act_within_limits");
    expect(autonomyRung("act_autonomously")).toBe("autonomous");
  });

  it("reads anything unrecognised as the most cautious rung", () => {
    expect(autonomyRung("wide_open")).toBe("suggest");
  });
});
