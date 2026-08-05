import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, action, labelsIn } from "./policy-detail";

// An endorsement is a new priced version of an agreement, so it is a create
// under `axis.bind`: the reference must be new, the premium must be a positive
// integer of minor units, and a sign-off refusal must reach the screen intact.

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
    request: new Request("https://web.test/axis/policies/pol_1/detail", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "pol_1" }
  } as unknown as ActionFunctionArgs;
}

function endorsement(over: Record<string, string> = {}) {
  const form = new FormData();
  form.set("intent", "endorse");
  form.set("basePolicyNo", "POL-1");
  form.set("policyNo", "POL-1-E");
  form.set("premiumMinor", "125000");
  form.set("endAt", "2027-01-31");
  form.set("customerId", "cus_1");
  form.set("providerId", "prv_1");
  form.set("currency", "AED");
  form.set("startAt", "1750000000000");
  form.set("idempotencyKey", "key-1");
  for (const [name, value] of Object.entries(over)) form.set(name, value);
  return form;
}

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
    expect(labelsIn("en")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
    expect(labelsIn("ar")("approvalTitle")).toBeTruthy();
  });

  it("renames the agreement noun for a non-insurance pack", () => {
    expect(labelsIn("en", "retail-ecom")("policies")).not.toBe(labelsIn("en")("policies"));
  });
});

describe("action", () => {
  it("posts a new version, not an edit of the current one", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ id: "pol_2" }), { status: 201, headers: { "content-type": "application/json" } }));

    const result = await action(args(endorsement()));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ policyNo: "POL-1-E", premiumMinor: 125000, currency: "AED" });
    expect(result.done).toBe("endorsed");
  });

  it("drops optional links it was not given", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ id: "pol_2" }), { status: 201, headers: { "content-type": "application/json" } }));

    await action(args(endorsement({ productId: "prd_1" })));

    const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect(body.productId).toBe("prd_1");
    expect("caseId" in body).toBe(false);
  });

  it("refuses a missing reference", async () => {
    const calls = stubFetch(new Response(null, { status: 201 }));
    const result = await action(args(endorsement({ policyNo: "  " })));
    expect(result.error).toBe("refRequired");
    expect(calls).toHaveLength(0);
  });

  it("refuses reusing the current reference, which the unique index would reject anyway", async () => {
    const result = await action(args(endorsement({ policyNo: "POL-1" })));
    expect(result.error).toBe("refSame");
  });

  it("refuses a premium that is not a positive whole number of minor units", async () => {
    for (const premiumMinor of ["0", "-1", "12.5", "abc", ""]) {
      const result = await action(args(endorsement({ premiumMinor })));
      expect(result.error, premiumMinor).toBe("premiumRequired");
    }
  });

  it("refuses an unparseable end date", async () => {
    const result = await action(args(endorsement({ endAt: "whenever" })));
    expect(result.error).toBe("endRequired");
  });

  it("returns the sign-off refusal for the screen to render", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ title: "approval required", status: 403, code: "approval_required", policy_key: "axis.bind" }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    const result = await action(args(endorsement()));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });

  it("rejects an intent it does not implement", async () => {
    const calls = stubFetch(new Response(null, { status: 201 }));
    const form = endorsement();
    form.set("intent", "cancel");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
