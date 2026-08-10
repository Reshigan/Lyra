import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  PERM,
  action,
  blockedReason,
  changesFrom,
  epochOf,
  labelsIn,
  loader,
  phrase
} from "./policy-endorse";

// A mid-term change is priced before it is written (§B.1): this screen is two
// calls sharing one changeset — preview, which writes nothing, then confirm,
// which writes exactly what the preview priced. Neither call carries an
// idempotency key on the preview; the confirm does not need one either since
// the API keys it off policy id + changeset hash server-side.

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

function args(form: FormData, id = "pol_1"): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/endorse", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id }
  } as unknown as ActionFunctionArgs;
}

function loadArgs(id = "pol_1"): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/endorse"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id }
  } as unknown as LoaderFunctionArgs;
}

const quote = {
  proRataDays: 100,
  termDays: 365,
  premiumDeltaMinor: 20_000,
  taxDeltaMinor: 1_000,
  commissionDeltaMinor: 2_000,
  chargeMinor: 5_753,
  commissionChargeMinor: 548,
  refundMinor: 0
};

describe("PERM", () => {
  it("gates the read and the two writes separately", () => {
    expect(PERM.read).toBe("axis:policies:read");
    expect(PERM.endorse).toBe("axis:policies:endorse");
  });
});

describe("labelsIn", () => {
  it("translates every key into Arabic", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      "back",
      "field.changes",
      "field.changesHint",
      "field.effectiveFrom",
      "field.premiumMinor",
      "field.reason",
      "preview.submit",
      "quote.proRataDays",
      "quote.chargeMinor",
      "quote.refundMinor",
      "quote.premiumDeltaMinor",
      "quote.taxDeltaMinor",
      "quote.commissionDeltaMinor",
      "referralNotice",
      "confirm.confirm",
      "confirm.submit",
      "blockedTitle",
      "blockedReason",
      "deniedTitle",
      "missingTitle",
      "missingBody",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "doneTitle",
      "doneBody",
      "doneLink",
      "problem.missing_changes",
      "problem.bad_changes",
      "problem.bad_intent"
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

  // CLAUDE.md §14 — same screen, different industry noun (see policy-cancel).
  it("takes the record's noun from the active domain pack", () => {
    const retail = labelsIn("en", "retail-ecom");
    expect(retail("title")).toBe("Endorse order");
    expect(retail("blockedReason")).toBe("Only a bound or active order can be endorsed.");

    for (const key of ["title", "back", "blockedTitle", "blockedReason", "deniedTitle"]) {
      expect(retail(key).toLowerCase(), key).not.toContain("policy");
    }
  });
});

describe("blockedReason", () => {
  it("blocks anything not on risk, mirroring the engine's own check", () => {
    expect(blockedReason({ status: "draft" })).toBe("blockedReason");
    expect(blockedReason({ status: "cancelled" })).toBe("blockedReason");
    expect(blockedReason({ status: "bound" })).toBeNull();
    expect(blockedReason({ status: "active" })).toBeNull();
  });
});

describe("epochOf", () => {
  it("reads a date input as UTC midnight and rejects anything else", () => {
    expect(epochOf("2026-08-04")).toBe(Date.parse("2026-08-04T00:00:00Z"));
    expect(epochOf("04/08/2026")).toBeNull();
    expect(epochOf("")).toBeNull();
  });
});

describe("changesFrom", () => {
  it("parses a JSON object of changes", () => {
    const form = new FormData();
    form.set("changes", '{"sumInsuredMinor": 5000000}');
    expect(changesFrom(form)).toEqual({ changes: { sumInsuredMinor: 5000000 } });
  });

  it("refuses empty input rather than pricing nothing", () => {
    const form = new FormData();
    form.set("changes", "");
    expect(changesFrom(form)).toEqual({ code: "missing_changes" });
  });

  it("refuses invalid JSON and refuses a JSON array or scalar", () => {
    const bad = new FormData();
    bad.set("changes", "{not json");
    expect(changesFrom(bad)).toEqual({ code: "bad_changes" });

    const arr = new FormData();
    arr.set("changes", "[1,2]");
    expect(changesFrom(arr)).toEqual({ code: "bad_changes" });
  });
});

describe("loader", () => {
  it("fetches the policy for a holder of both permissions", async () => {
    stubFetch(new Response(JSON.stringify({ id: "pol_1", status: "active" }), { status: 200 }));
    const loaded = await loader(loadArgs());
    expect(loaded.policy).toEqual({ id: "pol_1", status: "active" });
    expect(loaded.notFound).toBe(false);
  });

  it("reports notFound on a 404 rather than throwing", async () => {
    stubFetch(new Response(JSON.stringify({ title: "not found", status: 404 }), { status: 404 }));
    const loaded = await loader(loadArgs());
    expect(loaded.policy).toBeNull();
    expect(loaded.notFound).toBe(true);
  });

  it("degrades to denied on a 403 rather than throwing", async () => {
    stubFetch(new Response(JSON.stringify({ title: "forbidden", status: 403 }), { status: 403 }));
    const loaded = await loader(loadArgs());
    expect(loaded.policy).toBeNull();
    expect(loaded.may.read).toBe(false);
  });
});

describe("preview", () => {
  it("prices the changeset with no idempotency key", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ ...quote, needsApproval: true, needsReferral: false }), { status: 200 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("changes", '{"sumInsuredMinor": 5000000}');
    form.set("reason", "customer requested increase");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/endorse/preview");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      changes: { sumInsuredMinor: 5000000 },
      reason: "customer requested increase"
    });
    expect(result).toEqual({
      problem: null,
      done: "preview",
      preview: { ...quote, needsApproval: true, needsReferral: false },
      changes: { sumInsuredMinor: 5000000 },
      reason: "customer requested increase",
      effectiveFrom: null,
      premiumMinor: null
    });
  });

  it("carries effectiveFrom and premiumMinor when given", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ ...quote, needsApproval: false, needsReferral: false }), { status: 200 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("changes", "{}");
    form.set("effectiveFrom", "2026-09-01");
    form.set("premiumMinor", "150000");

    await action(args(form));

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      changes: {},
      effectiveFrom: Date.parse("2026-09-01T00:00:00Z"),
      premiumMinor: 150_000
    });
  });

  it("refuses to price an empty changeset without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("changes", "");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_changes");
    expect(calls).toHaveLength(0);
  });
});

describe("confirm", () => {
  it("writes exactly the changeset the preview priced, no idempotency key", async () => {
    const calls = stubFetch(
      new Response(
        JSON.stringify({ policy: { id: "pol_1", versionSeq: 2 }, version: { id: "pver_1" }, txn: { id: "txn_1" } }),
        { status: 200 }
      )
    );
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("changes", '{"sumInsuredMinor": 5000000}');
    form.set("reason", "customer requested increase");
    form.set("effectiveFrom", "2026-09-01");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/endorse");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      changes: { sumInsuredMinor: 5000000 },
      reason: "customer requested increase",
      effectiveFrom: Date.parse("2026-09-01T00:00:00Z")
    });
    expect(result).toEqual({
      problem: null,
      done: "confirm",
      policy: { id: "pol_1", versionSeq: 2 },
      version: { id: "pver_1" },
      txn: { id: "txn_1" }
    });
  });

  it("surfaces an approval gate instead of claiming the endorsement was written", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ title: "approval required", status: 403, code: "approval_required", policy_key: "axis.endorse" }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("changes", '{"sumInsuredMinor": 5000000}');

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });

  it("refuses an empty changeset without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("changes", "");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_changes");
    expect(calls).toHaveLength(0);
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "bind");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "missing_changes", status: 400, code: "missing_changes" }, l).title).toBe(
      l("problem.missing_changes")
    );
    expect(phrase({ title: "outside rating inputs", status: 400, code: "bad_request" }, l).title).toBe(
      "outside rating inputs"
    );
  });
});
