import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { PERM, action, labelsIn, loader, phrase } from "./renewal-desk";

// D.7: the AXIS operator view of orbit_renewals — a read of the same table
// orbit-save.tsx writes, joined to the policy head it renews. Two of its four
// intents (requote, lapse-intent) are the same PATCH orbit-save already makes;
// bind-renewal is the one-tap POST /v1/axis/policies/:id/renew (server derives
// its own idempotency key, same as endorse/cancel); offer is a link into
// ORBIT's save desk, not a write — "ORBIT sends it, AXIS does not" (spec).

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
    request: new Request("https://web.test/axis/renewals"),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/renewals", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const ALL_PERMS = [PERM.read, PERM.write, PERM.policyRead, PERM.renew];

const renewal = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "ren_1",
  policyRef: "pol_1",
  customerId: "cus_1",
  expiryAt: 1_772_000_000_000,
  churnScore: 72,
  strategy: "human",
  state: "scheduled",
  outcomeReason: null,
  ownerRef: null,
  offeredAt: null,
  decidedAt: null,
  requotesJson: null,
  createdAt: 1_760_000_000_000,
  ...over
});

const policy = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "pol_1",
  policyNo: "POL-0001",
  customerId: "cus_1",
  grossMinor: 45_000,
  currency: "ZAR",
  ...over
});

describe("PERM", () => {
  it("gates on the renewal reads/writes it already owns and the policies it renews", () => {
    expect(PERM.read).toBe("orbit:renewals:read");
    expect(PERM.write).toBe("orbit:renewals:update");
    expect(PERM.policyRead).toBe("axis:policies:read");
    expect(PERM.renew).toBe("axis:policies:renew");
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
      "holder",
      "expires",
      "daysLeft",
      "currentGross",
      "requotedBest",
      "delta",
      "risk",
      "strategy",
      "owner",
      "act",
      "requote",
      "offer",
      "bindRenewal",
      "lapse",
      "working",
      "saved",
      "auto_requote",
      "human",
      "do_not_contact",
      "problem.missing_renewal",
      "problem.missing_policy",
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

describe("the renewal desk loader", () => {
  it("joins scheduled and offered renewals to their policy head, soonest expiry first", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/v1/me")) return meResponse(ALL_PERMS);
      if (url.includes("state=scheduled")) {
        return new Response(
          JSON.stringify({ data: [renewal({ id: "ren_soon", expiryAt: 1_771_000_000_000, policyRef: "pol_soon" })] }),
          { status: 200 }
        );
      }
      if (url.includes("state=offered")) {
        return new Response(
          JSON.stringify({ data: [renewal({ id: "ren_later", state: "offered", expiryAt: 1_773_000_000_000, policyRef: "pol_later" })] }),
          { status: 200 }
        );
      }
      if (url.includes("/v1/axis/policies/pol_soon")) return new Response(JSON.stringify(policy({ id: "pol_soon" })), { status: 200 });
      if (url.includes("/v1/axis/policies/pol_later")) return new Response(JSON.stringify(policy({ id: "pol_later" })), { status: 200 });
      throw new Error(`unstubbed ${url}`);
    });

    const loaded = await loader(loadArgs());

    expect(loaded.rows.map((row) => row.renewal.id)).toEqual(["ren_soon", "ren_later"]);
    expect(loaded.rows[0]?.policy?.id).toBe("pol_soon");
    expect(loaded.rows[1]?.policy?.id).toBe("pol_later");
    expect(loaded.may).toEqual({ read: true, write: true, bind: true });
    expect(calls.some((c) => c.url.includes("state=scheduled"))).toBe(true);
    expect(calls.some((c) => c.url.includes("state=offered"))).toBe(true);
  });

  it("shows an empty desk with no policy calls when the renewal read is withheld", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/v1/me")) return meResponse([]);
      throw new Error(`unstubbed ${url}`);
    });

    const loaded = await loader(loadArgs());

    expect(loaded.rows).toEqual([]);
    expect(loaded.may).toEqual({ read: false, write: false, bind: false });
    expect(calls.some((c) => c.url.includes("/v1/axis/policies"))).toBe(false);
  });

  it("leaves the policy side of a row null rather than throwing when the policy read is withheld", async () => {
    stubFetch((url) => {
      if (url.includes("/v1/me")) return meResponse([PERM.read]);
      if (url.includes("state=scheduled")) return new Response(JSON.stringify({ data: [renewal()] }), { status: 200 });
      if (url.includes("state=offered")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      throw new Error(`unstubbed ${url}`);
    });

    const loaded = await loader(loadArgs());

    expect(loaded.rows).toHaveLength(1);
    expect(loaded.rows[0]?.policy).toBeNull();
  });
});

describe("requote and lapse-intent are the same strategy write orbit-save makes", () => {
  it("marks a renewal auto_requote, keyed so a double submit is one write", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(renewal({ strategy: "auto_requote" })), { status: 200 }));
    const form = new FormData();
    form.set("intent", "requote");
    form.set("id", "ren_1");
    form.set("nonce", "requote:abc:ren_1");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/orbit/renewals/ren_1");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.key).toBe("requote:abc:ren_1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ strategy: "auto_requote" });
    expect(result).toEqual({ problem: null, saved: "ren_1" });
  });

  it("marks a renewal do_not_contact", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(renewal({ strategy: "do_not_contact" })), { status: 200 }));
    const form = new FormData();
    form.set("intent", "lapse-intent");
    form.set("id", "ren_1");

    await action(args(form));

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ strategy: "do_not_contact" });
  });

  it("refuses without a renewal id, without a round trip", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "requote");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_renewal");
    expect(calls).toHaveLength(0);
  });
});

describe("bind-renewal", () => {
  it("posts the one-tap renewal with no client idempotency key — the API derives its own", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ policy: { id: "pol_2", status: "active" }, txn: { id: "txn_1" } }), { status: 200 }));
    const form = new FormData();
    form.set("intent", "bind-renewal");
    form.set("id", "pol_1");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/renew");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({});
    expect(result).toEqual({ problem: null, saved: "pol_1" });
  });

  it("refuses without a policy id, without a round trip", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "bind-renewal");

    const result = await action(args(form));

    expect(result.problem?.code).toBe("missing_policy");
    expect(calls).toHaveLength(0);
  });

  it("surfaces the lifecycle engine's refusal rather than claiming the term renewed", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ title: "cannot renew with no commission: RENEW posts a commission accrual", status: 400, code: "bad_request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
    );
    const form = new FormData();
    form.set("intent", "bind-renewal");
    form.set("id", "pol_1");

    const result = await action(args(form));

    expect(result.saved).toBeNull();
    expect(result.problem?.status).toBe(400);
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "offer");
    form.set("id", "ren_1");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("unknown_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "missing_renewal", status: 400, code: "missing_renewal" }, l).title).toBe(
      l("problem.missing_renewal")
    );
    expect(
      phrase({ title: "cannot renew with no commission: RENEW posts a commission accrual", status: 400, code: "bad_request" }, l)
        .title
    ).toBe("cannot renew with no commission: RENEW posts a commission accrual");
  });
});
