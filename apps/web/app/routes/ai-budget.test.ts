import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  ALL_MODULES,
  SET_LIMITS_PERMISSION,
  action as setLimitsAction,
  canSetLimits,
  ceilingsFor,
  limitFrom,
  type BudgetRow
} from "./ai-budget";
import { action as consoleAction } from "./ai-console";

// The AI spend ceiling is a consequential control (CLAUDE.md §4): who may move
// it, what counts as an amount, and what an untouched tenant sees before any
// ceiling exists. The killswitch next door is checked for the same reason — a
// pause that travels without its reason is a 400 the operator cannot read.

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

/** An action call without a worker: only `context.get(cloudflare)` is read. */
function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/admin/ai/budget", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const row = (over: Partial<BudgetRow> = {}): BudgetRow => ({
  id: "bud_1",
  day: "2026-07-30",
  module: ALL_MODULES,
  tokensUsed: 1_000,
  tokensLimit: 10_000,
  costMicroUsed: 500_000,
  costMicroLimit: 2_000_000,
  stoppedAt: null,
  updatedAt: 1_770_000_000_000,
  ...over
});

describe("canSetLimits", () => {
  it("offers the form only to an actor holding the permission the handler enforces", () => {
    expect(canSetLimits(["ai:budgets:read", SET_LIMITS_PERMISSION])).toBe(true);
  });

  it("withholds it from a reader — the control is absent, never disabled", () => {
    expect(canSetLimits(["ai:budgets:read", "ai:agents:write"])).toBe(false);
  });

  it("does not accept a wildcard, because /v1/me expands permissions", () => {
    expect(canSetLimits(["ai:*:*", "*:*:*"])).toBe(false);
  });
});

describe("limitFrom", () => {
  it("scales a major-unit cost into micro-USD", () => {
    expect(limitFrom("12.34", 1_000_000)).toBe(12_340_000);
  });

  it("reads a blank field as `leave this ceiling alone`", () => {
    expect(limitFrom("  ", 1)).toBeUndefined();
  });

  it("refuses a negative or unparseable amount", () => {
    expect(limitFrom("-1", 1)).toBeNull();
    expect(limitFrom("ten", 1)).toBeNull();
  });

  it("keeps zero, which the gateway reads as uncapped", () => {
    expect(limitFrom("0", 1_000_000)).toBe(0);
  });
});

describe("ceilingsFor", () => {
  it("shows nothing when no budget row has ever been written", () => {
    expect(ceilingsFor(null)).toEqual([]);
    expect(ceilingsFor([])).toEqual([]);
  });

  it("shows only the newest day, with the all-modules ceiling first", () => {
    const today = [
      row({ id: "b2", module: "orbit" }),
      row({ id: "b1", module: ALL_MODULES }),
      row({ id: "b3", module: "axis" })
    ];
    const yesterday = row({ id: "b0", day: "2026-07-29" });

    expect(ceilingsFor([yesterday, ...today]).map((r) => r.id)).toEqual(["b1", "b3", "b2"]);
  });
});

describe("set-limits action", () => {
  it("refuses to move a ceiling without the confirmation, without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "set-limits");
    form.set("costLimit", "25");

    const result = await setLimitsAction(args(form));

    expect(result.problem?.code).toBe("confirm_required");
    expect(calls).toHaveLength(0);
  });

  it("sends only the ceilings that were filled in", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "set-limits");
    form.set("confirm", "on");
    form.set("module", "orbit");
    form.set("costLimit", "25");

    const result = await setLimitsAction(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/ai/budget/limits");
    expect(calls[0]?.body).toBe(JSON.stringify({ module: "orbit", costMicroLimit: 25_000_000 }));
    expect(result).toEqual({ problem: null, saved: "orbit" });
  });

  it("reports a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );
    const form = new FormData();
    form.set("intent", "set-limits");
    form.set("confirm", "on");
    form.set("tokensLimit", "5000");

    const result = await setLimitsAction(args(form));

    expect(result.saved).toBeNull();
    expect(result.problem?.status).toBe(403);
  });
});

describe("agent pause", () => {
  it("carries the typed reason to the killswitch endpoint", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "pause");
    form.set("agentKey", "orbit.triage");
    form.set("reason", "spend spike overnight");

    await consoleAction(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/ai/agents/orbit.triage/pause");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ reason: "spend spike overnight" }));
  });
});
