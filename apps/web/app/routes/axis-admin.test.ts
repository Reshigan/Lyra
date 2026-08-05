import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, action, connectorHealth, connectorTone, labelsIn } from "./axis-admin";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET" });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/admin", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("labelsIn", () => {
  it("keeps ar on exactly the keys en has", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("translates every key rather than echoing english", () => {
    for (const [key, value] of Object.entries(LABELS.ar ?? {})) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toBe(LABELS.en?.[key]);
    }
  });

  it("falls back to the key rather than rendering nothing", () => {
    expect(labelsIn("de")("title")).toBe(LABELS.en?.title);
    expect(labelsIn("en")("nope")).toBe("nope");
  });
});

describe("connectorHealth", () => {
  it("counts deliveries per webhook by status, and finds the latest", () => {
    const hooks = [{ id: "whk_1", url: "https://hooks.test/a", status: "active" }];
    const deliveries = [
      { webhookId: "whk_1", status: "delivered", createdAt: 100 },
      { webhookId: "whk_1", status: "delivered", createdAt: 200 },
      { webhookId: "whk_1", status: "failed", createdAt: 150 },
      { webhookId: "whk_1", status: "dead", createdAt: 50 }
    ];
    expect(connectorHealth(hooks, deliveries)).toEqual([
      { webhookId: "whk_1", url: "https://hooks.test/a", status: "active", delivered: 2, failed: 1, dead: 1, pending: 0, lastDeliveryAt: 200 }
    ]);
  });

  it("reports a webhook with no deliveries yet rather than throwing", () => {
    const hooks = [{ id: "whk_2", url: "https://hooks.test/b", status: "active" }];
    expect(connectorHealth(hooks, [])).toEqual([
      { webhookId: "whk_2", url: "https://hooks.test/b", status: "active", delivered: 0, failed: 0, dead: 0, pending: 0, lastDeliveryAt: null }
    ]);
  });
});

describe("connectorTone", () => {
  it("is danger with any dead delivery, warning with any failure, success otherwise", () => {
    expect(connectorTone({ dead: 1, failed: 0 })).toBe("danger");
    expect(connectorTone({ dead: 0, failed: 1 })).toBe("warning");
    expect(connectorTone({ dead: 0, failed: 0 })).toBe("success");
  });
});

describe("publish", () => {
  it("returns the published sop id", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "sop_1", status: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "publish", sopId: "sop_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/sops/sop_1/publish");
    expect(calls[0]?.method).toBe("POST");
    expect(result.published).toBe("sop_1");
  });

  it("needs a sop id", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const result = await action(args(form({ intent: "publish" })));
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a refusal as a Problem rather than throwing", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "conflict", status: 409, detail: "sop is already active" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await action(args(form({ intent: "publish", sopId: "sop_1" })));
    expect(result.problem?.status).toBe(409);
    expect(result.published).toBeNull();
  });
});

describe("unknown intent", () => {
  it("answers 400 without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const result = await action(args(form({ intent: "nope" })));
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
