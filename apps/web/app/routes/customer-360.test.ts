import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { LABELS, PERM, action, chips, customerLede, labelsIn, loader } from "./customer-360";

// The 360 view is read-mostly; its one write puts a priced offer in front of a
// customer, which is consequential (docs/15 §4). So: the offer id is required
// before anything is called, a refusal comes back as a Problem the screen can
// render, and an intent nobody declared is a 400 rather than a guess.

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
    request: new Request("https://web.test/admin/customers/cus_1/360", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "cus_1" }
  } as unknown as ActionFunctionArgs;
}

const forbidden = () =>
  new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" }
  });

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
    expect(labelsIn("en")("approvalBody", { policy: "dist.offer_surface" })).toContain("dist.offer_surface");
  });
});

describe("panel permissions", () => {
  it("names a distinct scoped permission per panel, so one refusal hides one panel", () => {
    const values = Object.values(PERM);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => /^[a-z_]+:[a-z_]+:[a-z_]+$/.test(value))).toBe(true);
  });

  it("covers the cases panel and the activity timeline", () => {
    expect(PERM.cases).toBe("axis:cases:read");
    expect(PERM.audit).toBe("core:audit:read");
  });
});

describe("customerLede", () => {
  it("states the customer's type and identity-check status from the loaded record", () => {
    expect(customerLede({ type: "person", kycStatus: "verified" }, labelsIn("en"))).toBe("Individual customer · Verified");
  });
});

describe("chips", () => {
  it("passes string arrays through and answers everything else with empty", () => {
    expect(chips(["vip", "fleet"])).toEqual(["vip", "fleet"]);
    expect(chips(["ok", 7, null])).toEqual(["ok"]);
    expect(chips({ not: "an array" })).toEqual([]);
    expect(chips("vip")).toEqual([]);
    expect(chips(null)).toEqual([]);
    expect(chips(undefined)).toEqual([]);
  });

  it("dedupes repeated values so chipList never collides on the React key", () => {
    expect(chips(["vip", "vip"])).toEqual(["vip"]);
  });
});

describe("action", () => {
  it("surfaces an offer with the load's idempotency key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "surface");
    form.set("offerId", "nbo_1");
    form.set("idempotencyKey", "key-1");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/dist/next-best-offers/nbo_1/surface");
    expect(calls[0]?.method).toBe("POST");
    expect(result.done).toBe("surfaced");
  });

  it("records a dismissal as a decision, not a deletion", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "dismiss");
    form.set("offerId", "nbo_2");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/dist/next-best-offers/nbo_2/decide");
    expect(calls[0]?.body).toBe(JSON.stringify({ decision: "dismissed" }));
    expect(result.done).toBe("dismissed");
  });

  it("refuses a missing offer without calling anything", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "surface");

    const result = await action(args(form));

    expect(result.error).toBe("offerRequired");
    expect(calls).toHaveLength(0);
  });

  it("returns a refusal as a Problem rather than throwing", async () => {
    stubFetch(forbidden());
    const form = new FormData();
    form.set("intent", "surface");
    form.set("offerId", "nbo_3");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });

  it("rejects an intent it does not implement", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "delete-everything");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("loader", () => {
  it("pins every request URL, because safe() re-throws a 400 from a renamed param", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (input: URL | string) => {
      const url = String(input);
      urls.push(url);
      const body = url.endsWith("/v1/me")
        ? { permissions: Object.values(PERM) }
        : url.includes("/position")
          ? { positions: [], ltvMinor: 0, currency: "AED" }
          : url.includes("/v1/core/customers/")
            ? { id: "cus_1" }
            : { rows: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      );
    });

    await loader({
      request: new Request("https://web.test/admin/customers/cus_1/360"),
      context: { get: () => ({ env, ctx: null }) },
      params: { id: "cus_1" }
    } as unknown as LoaderFunctionArgs);

    const expected = [
      "https://api.test/v1/core/customers/cus_1",
      "https://api.test/v1/axis/policies?customerId=cus_1&limit=50",
      "https://api.test/v1/axis/claims?customerId=cus_1&limit=50",
      "https://api.test/v1/axis/cases?customerId=cus_1&limit=50",
      "https://api.test/v1/core/audit-log?subjectRef=cus_1&limit=20&sort=ts&order=desc",
      "https://api.test/v1/core/customers/cus_1/position",
      "https://api.test/v1/orbit/conversations?customerId=cus_1&limit=50",
      "https://api.test/v1/dist/quote-requests?customerId=cus_1&limit=50",
      "https://api.test/v1/core/consents?customerId=cus_1&limit=50",
      "https://api.test/v1/core/files?subjectRef=customer%3Acus_1&limit=50",
      "https://api.test/v1/dist/next-best-offers?customerId=cus_1&limit=50"
    ];
    for (const url of expected) expect(urls, url).toContain(url);
    expect(urls).toHaveLength(expected.length + 1); // + /v1/me — nothing extra, nothing doubled
  });
});
