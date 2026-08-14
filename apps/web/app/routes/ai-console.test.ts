import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action, agentNames, autonomyRung, consoleHeadline, ruleLabel } from "./ai-console";

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

// The recent-runs table read `renewal`, `qa`, `creative` — agent keys, on a
// screen whose own cards above them carry the names.
describe("agentNames", () => {
  const roster = [
    { key: "renewal", nameJson: { en: "Renewal agent", ar: "وكيل التجديد" } },
    { key: "qa", nameJson: null }
  ];

  it("names an agent in the reader's locale", () => {
    expect(agentNames(roster, "ar")["renewal"]).toBe("وكيل التجديد");
  });

  it("falls back to English before it falls back to the key", () => {
    expect(agentNames(roster, "fr")["renewal"]).toBe("Renewal agent");
  });

  it("keeps the key for an agent that carries no name", () => {
    expect(agentNames(roster, "en")["qa"]).toBe("qa");
  });
});

// The guardrail table printed the rule as stored — `hallucinated_placeholder` —
// on the one screen a compliance officer reads.
describe("ruleLabel", () => {
  const L = (key: string, fallback?: string) =>
    key === "rule.prompt_injection" ? "Prompt injection" : (fallback ?? key);

  it("names a rule the platform ships", () => {
    expect(ruleLabel(L, "prompt_injection")).toBe("Prompt injection");
  });

  it("humanises a rule a tenant wrote for itself", () => {
    expect(ruleLabel(L, "own_brand_tone")).toBe("Own brand tone");
  });
});

describe("consoleHeadline", () => {
  const L = (key: string, fallback?: string) => fallback ?? key;

  it("leads with a global pause, ahead of the roster", () => {
    expect(consoleHeadline({ global: true, tenant: false }, [{ status: "active" }], L)).toBe(
      "kill.globalOn"
    );
  });

  it("leads with a tenant pause once there is no global one", () => {
    expect(consoleHeadline({ global: false, tenant: true }, [{ status: "active" }], L)).toBe(
      "kill.tenantOn"
    );
  });

  it("says so when the roster could not be read", () => {
    expect(consoleHeadline(null, null, L)).toBe("agents.unavailable");
  });

  it("says so when no agent is configured", () => {
    expect(consoleHeadline(null, [], L)).toBe("headline.noAgents");
  });

  it("counts the agents actually active", () => {
    expect(
      consoleHeadline(null, [{ status: "active" }, { status: "paused" }, { status: "active" }], L)
    ).toBe("2 headline.agentsActive");
  });

  it("says so when every agent is paused", () => {
    expect(consoleHeadline(null, [{ status: "paused" }, { status: "retired" }], L)).toBe(
      "headline.allPaused"
    );
  });
});
