import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { ASSESSMENTS, LABELS, action, labelsIn } from "./claim-detail";

// Both writes here move money or commit to moving it, so both are gated by
// `axis.claim_settlement` server-side. The reducer's job is to validate minor
// units, keep the outcome inside the declared set, and hand a 403 to the Gate.

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
    request: new Request("https://web.test/axis/claims/clm_1/detail", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "clm_1" }
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  body.set("idempotencyKey", "key-1");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

const ok = () =>
  new Response(JSON.stringify({ id: "clm_1" }), { status: 200, headers: { "content-type": "application/json" } });

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

  it("answers the chrome Gate needs, with the rule interpolated", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.claim_settlement" })).toContain("axis.claim_settlement");
  });

  it("names every assessment outcome it offers", () => {
    for (const outcome of ASSESSMENTS) expect(labelsIn("en")(`status.${outcome}`)).not.toBe(`status.${outcome}`);
  });

  it("renames the claim noun for a non-insurance pack", () => {
    expect(labelsIn("en", "retail-ecom")("claims")).not.toBe(labelsIn("en")("claims"));
  });
});

describe("action: assess", () => {
  it("patches the outcome and the reserve together", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "assess", status: "approved", amountMinor: "500000" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims/clm_1");
    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: "approved", amountMinor: 500000 });
    expect(result.done).toBe("assessed");
  });

  it("leaves the reserve alone when the field is blank", async () => {
    const calls = stubFetch(ok());

    await action(args(form({ intent: "assess", status: "assessing", amountMinor: "" })));

    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: "assessing" });
  });

  it("refuses an outcome outside the declared set", async () => {
    const calls = stubFetch(ok());
    for (const status of ["", "settled", "whatever"]) {
      const result = await action(args(form({ intent: "assess", status })));
      expect(result.error, status).toBe("outcomeRequired");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a reserve that is not whole and non-negative minor units", async () => {
    for (const amountMinor of ["-1", "1.5", "lots"]) {
      const result = await action(args(form({ intent: "assess", status: "approved", amountMinor })));
      expect(result.error, amountMinor).toBe("settleRequired");
    }
  });
});

describe("action: settle", () => {
  it("patches the settled amount and moves the claim to settled", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "settle", settledMinor: "480000" })));

    expect(JSON.parse(calls[0]!.body!)).toEqual({ settledMinor: 480000, status: "settled" });
    expect(result.done).toBe("settleDone");
  });

  it("refuses a settlement that is not a positive whole number of minor units", async () => {
    const calls = stubFetch(ok());
    for (const settledMinor of ["0", "-5", "12.34", "", "none"]) {
      const result = await action(args(form({ intent: "settle", settledMinor })));
      expect(result.error, settledMinor).toBe("settleRequired");
    }
    expect(calls).toHaveLength(0);
  });

  it("surfaces the sign-off refusal instead of pretending the money moved", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "axis.claim_settlement"
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    const result = await action(args(form({ intent: "settle", settledMinor: "480000" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});

describe("action: anything else", () => {
  it("rejects an intent it does not implement", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "reopen" })));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
