import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { PERM, action, labelsIn, loader, parseTerms, phrase } from "./referral-desk";

// §A.4/§D.6: the underwriter's side of the referral gate.ts opens on the bind
// path. One read (open referrals, soonest SLA first) and one write — POST
// /v1/axis/referrals/:id/decide — whose body carries its own `intent`, which is
// why this is a route and not a declarative ActionSpec: record.tsx already owns
// the form field named `intent`, so a declared field of that name is shadowed.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  url: string;
  method: string;
  body: string | null;
  key: string | null;
}

function stubFetch(router: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: new Headers(init.headers).get("idempotency-key")
    });
    return Promise.resolve(router(url).clone());
  });
  return calls;
}

function meResponse(permissions: string[]) {
  return new Response(JSON.stringify({ locale: "en", permissions }), { status: 200 });
}

function loadArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/referrals"),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/referrals", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const referral = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "rfl_1",
  caseId: "cas_1",
  policyId: null,
  quoteResponseId: "qr_1",
  kind: "authority_limit",
  triggerJson: { rule: "authority.gross", limitMinor: 500_000, valueMinor: 900_000 },
  valueMinor: 900_000,
  currency: "ZAR",
  state: "open",
  decidedBy: null,
  decisionNote: null,
  counterTermsJson: null,
  approvalId: "apr_1",
  slaDueAt: 1_772_000_000_000,
  createdAt: 1_771_000_000_000,
  ...over
});

describe("PERM", () => {
  it("gates on the one permission the decide endpoint requires", () => {
    expect(PERM.decide).toBe("axis:policies:decide_referral");
  });
});

describe("labelsIn", () => {
  it("translates every key into Arabic", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      "empty",
      "count",
      "referral",
      "value",
      "slaDue",
      "daysLeft",
      "trigger",
      "triggerWhy",
      "act",
      "accept",
      "decline",
      "counter",
      "reason",
      "counterTerms",
      "counterHint",
      "more",
      "saved",
      "kind.authority_limit",
      "kind.eligibility",
      "kind.sanctions",
      "kind.manual",
      "problem.missing_referral",
      "problem.missing_reason",
      "problem.missing_terms",
      "problem.bad_terms",
      "problem.unknown_intent"
    ];

    for (const key of keys) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("falls back to English rather than showing a raw key", () => {
    expect(labelsIn("de")("title")).toBe(labelsIn("en")("title"));
  });
});

describe("the referral desk loader", () => {
  it("reads the open referrals, soonest SLA first", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/v1/me")) return meResponse([PERM.decide]);
      if (url.includes("/v1/axis/referrals")) return new Response(JSON.stringify({ data: [referral()] }), { status: 200 });
      throw new Error(`unstubbed ${url}`);
    });

    const loaded = await loader(loadArgs());

    expect(loaded.rows.map((row) => row.id)).toEqual(["rfl_1"]);
    expect(loaded.may).toEqual({ decide: true });
    const read = calls.find((c) => c.url.includes("/v1/axis/referrals"))?.url ?? "";
    expect(read).toContain("state=open");
    expect(read).toContain("sort=slaDueAt");
    expect(read).toContain("order=asc");
  });

  it("shows an empty desk with no referral call when the permission is withheld", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/v1/me")) return meResponse([]);
      throw new Error(`unstubbed ${url}`);
    });

    const loaded = await loader(loadArgs());

    expect(loaded.rows).toEqual([]);
    expect(loaded.may).toEqual({ decide: false });
    expect(calls.some((c) => c.url.includes("/v1/axis/referrals"))).toBe(false);
  });
});

describe("parseTerms", () => {
  it("takes an object and refuses everything else", () => {
    expect(parseTerms('{"excessMinor":50000}')).toEqual({ excessMinor: 50_000 });
    expect(parseTerms("[1,2]")).toBeNull();
    expect(parseTerms('"text"')).toBeNull();
    expect(parseTerms("null")).toBeNull();
    expect(parseTerms("{oops")).toBeNull();
  });
});

describe("deciding a referral", () => {
  it("accepts, keyed so a double submit is one decision", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(referral({ state: "accepted" })), { status: 200 }));
    const form = new FormData();
    form.set("intent", "accept");
    form.set("id", "rfl_1");
    form.set("nonce", "accept:abc:rfl_1");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/referrals/rfl_1/decide");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBe("accept:abc:rfl_1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ intent: "accept" });
    expect(result).toEqual({ problem: null, saved: "rfl_1" });
  });

  it("declines with the reason the endpoint demands", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(referral({ state: "declined" })), { status: 200 }));
    const form = new FormData();
    form.set("intent", "decline");
    form.set("id", "rfl_1");
    form.set("reason", "outside appetite: fleet over 40 vehicles");

    await action(args(form));

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      intent: "decline",
      reason: "outside appetite: fleet over 40 vehicles"
    });
  });

  it("refuses a reasonless decline without a round trip", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "decline");
    form.set("id", "rfl_1");
    form.set("reason", "   ");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_reason");
    expect(calls).toHaveLength(0);
  });

  it("counters with parsed terms, not the raw string the endpoint would reject", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(referral({ state: "counter_offered" })), { status: 200 }));
    const form = new FormData();
    form.set("intent", "counter");
    form.set("id", "rfl_1");
    form.set("counterTerms", '{"excessMinor":50000}');
    form.set("reason", "accept at a higher excess");

    await action(args(form));

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      intent: "counter",
      reason: "accept at a higher excess",
      counterTermsJson: { excessMinor: 50_000 }
    });
  });

  it("refuses a counter with no terms, and a counter with unreadable terms", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const bare = new FormData();
    bare.set("intent", "counter");
    bare.set("id", "rfl_1");
    expect((await action(args(bare))).problem?.code).toBe("missing_terms");

    const bad = new FormData();
    bad.set("intent", "counter");
    bad.set("id", "rfl_1");
    bad.set("counterTerms", "{oops");
    expect((await action(args(bad))).problem?.code).toBe("bad_terms");

    expect(calls).toHaveLength(0);
  });

  it("refuses without a referral id, without a round trip", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "accept");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_referral");
    expect(calls).toHaveLength(0);
  });

  it("surfaces the endpoint's conflict rather than claiming the referral decided", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ title: "referral is accepted, not open", status: 409, code: "conflict" }), {
          status: 409,
          headers: { "content-type": "application/json" }
        })
    );
    const form = new FormData();
    form.set("intent", "accept");
    form.set("id", "rfl_1");

    const result = await action(args(form));

    expect(result.saved).toBeNull();
    expect(result.problem?.status).toBe(409);
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "refer-up");
    form.set("id", "rfl_1");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("unknown_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "missing_reason", status: 400, code: "missing_reason" }, l).title).toBe(
      l("problem.missing_reason")
    );
    expect(phrase({ title: "referral is accepted, not open", status: 409, code: "conflict" }, l).title).toBe(
      "referral is accepted, not open"
    );
  });
});
