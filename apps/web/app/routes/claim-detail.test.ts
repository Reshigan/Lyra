import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  CLAIM_TRANSITIONS,
  LABELS,
  PERM,
  RESERVE_BASES,
  action,
  hopsFor,
  labelsIn,
  loader,
  payeeOptions
} from "./claim-detail";

// Nothing on this screen overwrites money. A reserve is appended (the desk's
// history of what it thought the claim was worth), a hop is a declared
// transition, and a payment leaves through the ledger — never a PATCH of
// `settledMinor`. The reducer's job is to keep those three apart, validate
// minor units, refuse an illegal hop before the server has to, and hand a 403
// to the Gate.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null; idempotencyKey: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      idempotencyKey: new Headers(init.headers).get("idempotency-key")
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

/* ------------------------------------------------------------------ loader */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const CLAIM = {
  id: "clm_1",
  policyId: "pol_1",
  customerId: "cus_1",
  claimNo: "CLM-1",
  reportedAt: 1_750_000_000_000,
  amountMinor: 500_000,
  currency: "AED",
  status: "assessing",
  coverageState: "in_force",
  policyVersionId: "pvr_2",
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000
};

const RESERVE = { id: "rsv_1", seq: 2, head: "indemnity", amountMinor: 500_000, previousMinor: 300_000 };
const PAYMENT = { id: "pay_1", kind: "indemnity", payeeRef: "vendor:garage-1", amountMinor: 200_000, state: "paid" };
const RECOVERY = { id: "rec_1", kind: "salvage", expectedMinor: 50_000, state: "pursuing" };

function stubLoader(permissions: string[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions }));
    if (url.endsWith("/v1/axis/claims/clm_1")) return Promise.resolve(json(CLAIM));
    if (url.includes("/reserves")) return Promise.resolve(json({ data: [RESERVE], total: 1 }));
    if (url.endsWith("/payments")) return Promise.resolve(json({ data: [PAYMENT], total: 1 }));
    if (url.endsWith("/recoveries")) return Promise.resolve(json({ data: [RECOVERY], total: 1 }));
    return Promise.resolve(json({ data: [] }));
  });
  return calls;
}

function loadArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/claims/clm_1/detail"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "clm_1" }
  } as unknown as LoaderFunctionArgs;
}

/* ------------------------------------------------------------------- tests */

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

  it("names every hop and every reserve basis it offers", () => {
    for (const hops of Object.values(CLAIM_TRANSITIONS)) {
      for (const to of hops) expect(labelsIn("en")(`status.${to}`), to).not.toBe(`status.${to}`);
    }
    for (const basis of RESERVE_BASES) expect(labelsIn("ar")(`basis.${basis}`), basis).not.toBe(`basis.${basis}`);
  });

  it("renames the claim noun for a non-insurance pack", () => {
    expect(labelsIn("en", "retail-ecom")("claims")).not.toBe(labelsIn("en")("claims"));
  });
});

describe("hopsFor", () => {
  it("offers only the hops the state machine allows", () => {
    expect(hopsFor("assessing")).toEqual(CLAIM_TRANSITIONS.assessing);
    expect(hopsFor("assessing")).toContain("approved");
    expect(hopsFor("nonsense")).toEqual([]);
  });

  it("never offers a hop that only money may make", () => {
    // `settling` and `settled` are reached by requesting a payment. The API
    // refuses them as transitions; the UI must not offer the dead end.
    for (const status of Object.keys(CLAIM_TRANSITIONS)) {
      expect(hopsFor(status), status).not.toContain("settling");
      expect(hopsFor(status), status).not.toContain("settled");
    }
  });
});

describe("action: reserve", () => {
  it("the reserve control appends rather than overwrites", async () => {
    // The bug this replaces: the reserve was an `amountMinor` field PATCHed
    // onto the claim, so yesterday's estimate was gone and no one could say
    // who moved it or why. A reserve is a movement with a basis behind it.
    const calls = stubFetch(ok());

    const result = await action(
      args(
        form({
          intent: "reserve",
          head: "indemnity",
          amountMinor: "500000",
          basis: "assessor",
          rationale: "engineer report"
        })
      )
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims/clm_1/reserves");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      head: "indemnity",
      amountMinor: 500000,
      basis: "assessor",
      rationale: "engineer report"
    });
    expect(result.done).toBe("reserveDone");
    for (const call of calls) expect(call.method).not.toBe("PATCH");
  });

  it("refuses a reserve that is not whole and non-negative minor units", async () => {
    const calls = stubFetch(ok());
    for (const amountMinor of ["-1", "1.5", "", "lots"]) {
      const result = await action(args(form({ intent: "reserve", basis: "assessor", amountMinor })));
      expect(result.error, amountMinor).toBe("reserveRequired");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a basis outside the declared set", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "reserve", basis: "vibes", amountMinor: "1" })));

    expect(result.error).toBe("basisRequired");
    expect(calls).toHaveLength(0);
  });
});

describe("action: transition", () => {
  it("moves the claim along a declared hop, not by patching its status", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "transition", from: "assessing", to: "approved", reason: "ok" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims/clm_1/transition");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ to: "approved", reason: "ok" });
    expect(result.done).toBe("transitionDone");
  });

  it("refuses a hop the state machine does not allow", async () => {
    const calls = stubFetch(ok());
    for (const [from, to] of [
      ["assessing", "settled"],
      ["reported", "approved"],
      ["closed", "whatever"],
      ["", "approved"]
    ]) {
      const result = await action(args(form({ intent: "transition", from: from!, to: to! })));
      expect(result.error, `${from}->${to}`).toBe("outcomeRequired");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("action: request-payment", () => {
  it("money leaves through the ledger, never through a PATCH", async () => {
    const calls = stubFetch(ok());

    const result = await action(
      args(
        form({
          intent: "request-payment",
          kind: "indemnity",
          payeeKind: "repairer",
          payeeRef: "vendor:garage-1",
          amountMinor: "480000",
          method: "eft"
        })
      )
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/claims/clm_1/payments");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      kind: "indemnity",
      payeeKind: "repairer",
      payeeRef: "vendor:garage-1",
      amountMinor: 480000,
      method: "eft"
    });
    expect(result.done).toBe("paymentDone");
  });

  it("refuses a payment that is not a positive whole number of minor units, or has no payee", async () => {
    const calls = stubFetch(ok());
    for (const amountMinor of ["0", "-5", "12.34", "", "none"]) {
      const result = await action(
        args(form({ intent: "request-payment", payeeKind: "repairer", payeeRef: "v:1", amountMinor }))
      );
      expect(result.error, amountMinor).toBe("payRequired");
    }
    const noPayee = await action(
      args(form({ intent: "request-payment", payeeKind: "repairer", payeeRef: " ", amountMinor: "100" }))
    );
    expect(noPayee.error).toBe("payRequired");
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

    const result = await action(
      args(
        form({
          intent: "request-payment",
          kind: "indemnity",
          payeeKind: "claimant",
          payeeRef: "cus_1",
          amountMinor: "480000",
          method: "eft"
        })
      )
    );

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});

describe("action: idempotency key", () => {
  it("keys each intent by what it would write, so two writes in one page load don't collide", async () => {
    // All three intents share the one key the loader mints per page load. A
    // bare `key-1` replays the first write's body onto the second and 409s
    // ("idempotency key reused with a different body"), and a per-intent
    // suffix alone still collides for two reserves in the same load.
    const calls = stubFetch(ok());

    await action(args(form({ intent: "reserve", basis: "assessor", amountMinor: "500000" })));
    await action(args(form({ intent: "reserve", basis: "assessor", amountMinor: "620000" })));
    await action(args(form({ intent: "transition", from: "assessing", to: "approved" })));
    await action(
      args(
        form({
          intent: "request-payment",
          kind: "indemnity",
          payeeKind: "claimant",
          payeeRef: "cus_1",
          amountMinor: "480000"
        })
      )
    );

    expect(calls.map((call) => call.idempotencyKey)).toEqual([
      "key-1:reserve:indemnity:500000",
      "key-1:reserve:indemnity:620000",
      "key-1:transition:approved",
      "key-1:payment:480000"
    ]);
  });
});

describe("action: anything else", () => {
  it("rejects an intent it does not implement", async () => {
    const calls = stubFetch(ok());

    const result = await action(args(form({ intent: "settle" })));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("loader", () => {
  it("reads the claim's own money, and only this claim's", async () => {
    const calls = stubLoader(Object.values(PERM));

    const loaded = await loader(loadArgs());

    expect(calls).toContain("https://api.test/v1/axis/claims/clm_1/reserves?limit=25");
    expect(calls).toContain("https://api.test/v1/axis/claims/clm_1/payments");
    expect(calls).toContain("https://api.test/v1/axis/claims/clm_1/recoveries");
    expect(loaded.reserves).toEqual([RESERVE]);
    expect(loaded.payments).toEqual([PAYMENT]);
    expect(loaded.recoveries).toEqual([RECOVERY]);
  });

  it("degrades a refused panel rather than the page", async () => {
    vi.stubGlobal("fetch", (input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions: Object.values(PERM) }));
      if (url.endsWith("/v1/axis/claims/clm_1")) return Promise.resolve(json(CLAIM));
      if (url.endsWith("/payments")) {
        return Promise.resolve(
          new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
            status: 403,
            headers: { "content-type": "application/json" }
          })
        );
      }
      return Promise.resolve(json({ data: [] }));
    });

    const loaded = await loader(loadArgs());

    expect(loaded.claim?.id).toBe("clm_1");
    expect(loaded.payments).toEqual([]);
  });

  it("offers a write only to an actor who may make it", async () => {
    stubLoader(["axis:claims:read", "axis:claims:reserve"]);

    const loaded = await loader(loadArgs());

    expect(loaded.may).toMatchObject({ read: true, reserve: true, pay: false, update: false });
  });
});

describe("payeeOptions", () => {
  // The payee box asked for `customer:cu_01KE…` typed by hand, so paying the
  // claimant — the common case — meant copying an id off another screen.
  it("offers the claimant by name, under the ref the API expects", () => {
    expect(payeeOptions("cu_01KE953T000WTENZD6WY9TPYA0", "Amina Haddad")).toEqual([
      { id: "customer:cu_01KE953T000WTENZD6WY9TPYA0", label: "Amina Haddad" }
    ]);
  });

  it("offers nothing when the holder cannot be named, leaving the typed ref", () => {
    expect(payeeOptions("cu_01KE953T000WTENZD6WY9TPYA0", null)).toEqual([]);
  });
});
