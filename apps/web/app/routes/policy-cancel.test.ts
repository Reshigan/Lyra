import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { PERM, action, blockedReason, epochOf, labelsIn, loader, phrase } from "./policy-cancel";

// Cancellation is priced before it is written (§B.2/§D.5): preview quotes the
// refund and clawback, writes nothing; confirm writes exactly what the
// preview priced. Neither call carries a client idempotency key — the API
// derives its own from the policy id server-side, same as endorse.

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
    request: new Request("https://web.test/axis/policies/pol_1/cancel", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id }
  } as unknown as ActionFunctionArgs;
}

function loadArgs(id = "pol_1"): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/cancel"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id }
  } as unknown as LoaderFunctionArgs;
}

const quote = { effectiveAt: 1_770_000_000_000, refundMinor: 12_000, clawbackMinor: 800, proRataDays: 40, currency: "ZAR" };

describe("PERM", () => {
  it("gates the read and the single write permission", () => {
    expect(PERM.read).toBe("axis:policies:read");
    expect(PERM.cancel).toBe("axis:policies:cancel");
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
      "field.reasonCode",
      "field.refundMethod",
      "field.refundMethod.credit",
      "field.refundMethod.bank",
      "field.refundMethod.none",
      "field.note",
      "field.effectiveAt",
      "preview.submit",
      "quote.proRataDays",
      "quote.refundMinor",
      "quote.clawbackMinor",
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
      "problem.missing_reason",
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
    expect(epochOf("2026-09-01")).toBe(Date.parse("2026-09-01T00:00:00Z"));
    expect(epochOf("01/09/2026")).toBeNull();
    expect(epochOf("")).toBeNull();
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
  it("prices the cancellation with no idempotency key", async () => {
    const calls = stubFetch(new Response(JSON.stringify(quote), { status: 200 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("reasonCode", "customer_request");
    form.set("refundMethod", "bank");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/cancel/preview");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ reasonCode: "customer_request", refundMethod: "bank" });
    expect(result).toEqual({
      problem: null,
      done: "preview",
      preview: quote,
      reasonCode: "customer_request",
      refundMethod: "bank",
      note: null,
      effectiveAt: null
    });
  });

  it("carries effectiveAt and note when given, and defaults refundMethod to credit", async () => {
    const calls = stubFetch(new Response(JSON.stringify(quote), { status: 200 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("reasonCode", "customer_request");
    form.set("effectiveAt", "2026-09-01");
    form.set("note", "left a voicemail");

    await action(args(form));

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      reasonCode: "customer_request",
      refundMethod: "credit",
      effectiveAt: Date.parse("2026-09-01T00:00:00Z"),
      note: "left a voicemail"
    });
  });

  it("refuses to price without a reason, without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "preview");
    form.set("reasonCode", "");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_reason");
    expect(calls).toHaveLength(0);
  });
});

describe("confirm", () => {
  it("writes exactly what the preview priced, no idempotency key", async () => {
    const calls = stubFetch(
      new Response(
        JSON.stringify({
          policy: { id: "pol_1", status: "cancelled" },
          txn: { id: "txn_1" },
          refundTxn: { id: "txn_2" },
          refundMinor: 12_000,
          clawbackMinor: 800,
          effectiveAt: 1_770_000_000_000
        }),
        { status: 200 }
      )
    );
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("reasonCode", "customer_request");
    form.set("refundMethod", "bank");
    form.set("effectiveAt", "2026-09-01");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/cancel");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      reasonCode: "customer_request",
      refundMethod: "bank",
      effectiveAt: Date.parse("2026-09-01T00:00:00Z")
    });
    expect(result).toEqual({
      problem: null,
      done: "confirm",
      policy: { id: "pol_1", status: "cancelled" },
      txn: { id: "txn_1" },
      refundTxn: { id: "txn_2" },
      refundMinor: 12_000,
      clawbackMinor: 800,
      effectiveAt: 1_770_000_000_000
    });
  });

  it("surfaces an approval gate instead of claiming the cancellation was written", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ title: "approval required", status: 403, code: "approval_required", policy_key: "ledger.refund" }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("reasonCode", "customer_request");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });

  it("refuses without a reason, without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "confirm");
    form.set("reasonCode", "");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_reason");
    expect(calls).toHaveLength(0);
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "reinstate");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "missing_reason", status: 400, code: "missing_reason" }, l).title).toBe(
      l("problem.missing_reason")
    );
    expect(phrase({ title: "cancelling from inception is not-taken-up; use POST /ntu", status: 400, code: "bad_request" }, l).title).toBe(
      "cancelling from inception is not-taken-up; use POST /ntu"
    );
  });
});
