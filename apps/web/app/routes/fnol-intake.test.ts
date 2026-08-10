import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  PERM,
  action,
  epochOf,
  fnolFrom,
  labelsIn,
  phrase,
  type Coverage
} from "./fnol-intake";

// FNOL is two calls sharing one form: a read-only coverage check the desk runs
// before anything is written, then the register itself — which posts even when
// cover says no, because refusing to record a notification is a conduct
// failure. This file pins that split: what each call sends, what it returns,
// and the refusals that keep a claim from being registered against nothing.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null; key: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: new Headers(init.headers).get("idempotency-key")
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/claims/new", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

describe("PERM", () => {
  it("gates both the coverage check and the register on the same permission", () => {
    expect(PERM.register).toBe("axis:claims:register");
  });
});

describe("labelsIn", () => {
  it("translates every key into Arabic, coverage states and perils included", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      "policyId",
      "field.incidentAt",
      "field.peril",
      "field.cause",
      "field.description",
      "field.amount",
      "field.contact",
      "field.channel",
      "checkCover.submit",
      "register.submit",
      "guardrail.title",
      "guardrail.registerAnyway",
      "coverage.title",
      "coverageState.in_force",
      "coverageState.not_yet_incepted",
      "coverageState.lapsed_at_loss",
      "coverageState.cancelled_at_loss",
      "coverageState.out_of_cover",
      "coverageState.unknown",
      "peril.fire",
      "peril.theft",
      "peril.collision",
      "peril.weather",
      "peril.liability",
      "peril.other",
      "done.check-cover",
      "done.register",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "problem.missing_policy",
      "problem.missing_date",
      "problem.bad_amount",
      "problem.bad_intent"
    ];

    for (const key of keys) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("interpolates the gating policy and the registered claim number", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
    expect(labelsIn("en")("done.register", { claimNo: "CLM-1" })).toContain("CLM-1");
  });

  it("falls back to English rather than showing a raw key", () => {
    expect(labelsIn("de")("title")).toBe(labelsIn("en")("title"));
  });
});

describe("epochOf", () => {
  it("reads a date input as UTC midnight and rejects anything else", () => {
    expect(epochOf("2026-08-04")).toBe(Date.parse("2026-08-04T00:00:00Z"));
    expect(epochOf("04/08/2026")).toBeNull();
    expect(epochOf("")).toBeNull();
  });
});

describe("fnolFrom", () => {
  const full = () => {
    const form = new FormData();
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");
    form.set("perilCode", "fire");
    form.set("causeCode", "electrical");
    form.set("description", "kitchen fire");
    form.set("amountMinor", "500000");
    form.set("contact", "+971500000000");
    form.set("channel", "phone");
    return form;
  };

  it("builds the full FNOL body, amountMinor included — the real schema field, not notifiedMinor", () => {
    expect(fnolFrom(full())).toEqual({
      body: {
        policyId: "pol_1",
        incidentAt: Date.parse("2026-08-01T00:00:00Z"),
        perilCode: "fire",
        causeCode: "electrical",
        description: "kitchen fire",
        amountMinor: 500_000,
        contact: "+971500000000",
        channel: "phone"
      }
    });
  });

  it("refuses a claim naming no policy", () => {
    const form = full();
    form.set("policyId", "");
    expect(fnolFrom(form)).toEqual({ code: "missing_policy" });
  });

  it("refuses a claim with no incident date", () => {
    const form = full();
    form.set("incidentAt", "");
    expect(fnolFrom(form)).toEqual({ code: "missing_date" });
  });

  it("nulls out the optional fields rather than sending empty strings", () => {
    const form = new FormData();
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");
    expect(fnolFrom(form)).toEqual({
      body: {
        policyId: "pol_1",
        incidentAt: Date.parse("2026-08-01T00:00:00Z"),
        perilCode: null,
        causeCode: null,
        description: null,
        amountMinor: null,
        contact: null,
        channel: null
      }
    });
  });

  it("refuses rather than inventing an incurred amount from garbage input", () => {
    const form = full();
    form.set("amountMinor", "a lot");
    expect(fnolFrom(form)).toEqual({ code: "bad_amount" });
  });
});

describe("check-cover", () => {
  const coverage: Coverage = {
    coverageState: "in_force",
    policyVersionId: "polv_1",
    versionSeq: 2,
    limits: { deathMinor: 100_000_000 },
    excessMinor: 50_000,
    warnings: []
  };

  it("checks cover before anything is written, with no idempotency key", async () => {
    const calls = stubFetch(new Response(JSON.stringify(coverage), { status: 200 }));
    const form = new FormData();
    form.set("intent", "check-cover");
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims/coverage-check");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(
      JSON.stringify({ policyId: "pol_1", incidentAt: Date.parse("2026-08-01T00:00:00Z") })
    );
    expect(calls[0]?.key).toBeNull();
    expect(result).toEqual({ problem: null, done: "check-cover", coverage });
  });

  it("refuses a check naming no policy or no date, without calling the API", async () => {
    const calls = stubFetch(new Response(JSON.stringify(coverage), { status: 200 }));

    const noPolicy = new FormData();
    noPolicy.set("intent", "check-cover");
    noPolicy.set("incidentAt", "2026-08-01");
    expect((await action(args(noPolicy))).problem?.code).toBe("missing_policy");

    const noDate = new FormData();
    noDate.set("intent", "check-cover");
    noDate.set("policyId", "pol_1");
    expect((await action(args(noDate))).problem?.code).toBe("missing_date");

    expect(calls).toHaveLength(0);
  });
});

describe("register", () => {
  it("registers the claim with an idempotency key and surfaces the claim number", async () => {
    const calls = stubFetch(
      new Response(
        JSON.stringify({
          claim: { id: "clm_1", claimNo: "CLM-0001" },
          coverage: { coverageState: "in_force" },
          txn: { id: "txn_1" }
        }),
        { status: 201 }
      )
    );
    const form = new FormData();
    form.set("intent", "register");
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");
    form.set("amountMinor", "500000");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    expect(sent.amountMinor).toBe(500_000);
    expect(sent).not.toHaveProperty("notifiedMinor");
    expect(result).toEqual({ problem: null, done: "register", claimId: "clm_1", claimNo: "CLM-0001" });
  });

  it("registers a claim out of cover too — refusing to record a notification is a conduct failure", async () => {
    const calls = stubFetch(
      new Response(
        JSON.stringify({
          claim: { id: "clm_2", claimNo: "CLM-0002" },
          coverage: { coverageState: "out_of_cover" },
          txn: { id: "txn_2" }
        }),
        { status: 201 }
      )
    );
    const form = new FormData();
    form.set("intent", "register");
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");

    const result = await action(args(form));

    expect(calls).toHaveLength(1);
    expect(result.done).toBe("register");
  });

  it("refuses a registration naming no policy or no date, without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));

    const form = new FormData();
    form.set("intent", "register");
    expect((await action(args(form))).problem?.code).toBe("missing_policy");

    expect(calls).toHaveLength(0);
  });

  // The platform's own `axis.claims.register`-shaped gate (docs/12 §4) — this
  // one covers the case where an amount pushes a claim over an approval
  // threshold. The screen must say "waiting on sign-off", not "registered".
  it("surfaces an approval gate instead of claiming the claim was registered", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "axis.claim_reserve"
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const form = new FormData();
    form.set("intent", "register");
    form.set("policyId", "pol_1");
    form.set("incidentAt", "2026-08-01");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "attach");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "missing_policy", status: 400, code: "missing_policy" }, l).title).toBe(
      l("problem.missing_policy")
    );
    expect(phrase({ title: "duplicate claim number", status: 409, code: "conflict" }, l).title).toBe(
      "duplicate claim number"
    );
  });
});
