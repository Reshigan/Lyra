import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action as registerAction, registrationKind } from "./portal.$tenantSlug.register";
import { action as quotesAction, initialValues } from "./portal.$tenantSlug.quotes.$id";

// The public registration form and the comparison sliders are the two surfaces
// on the storefront that talk to the API without a session, so what is worth
// asserting is what leaves the browser: a blank optional box is an omission and
// not an empty string (the API takes `.strict()` objects with `.min(1)` on each
// one, so "" is a 400), a person body never carries business fields, and a
// slider never re-implements the price — it posts criteria and renders what
// comes back.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(...replies: Response[]) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  let at = 0;
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    });
    const reply = replies[Math.min(at, replies.length - 1)] ?? new Response(null, { status: 204 });
    at += 1;
    return Promise.resolve(reply.clone());
  });
  return calls;
}

const form = (fields: Record<string, string>): FormData => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
};

function args(url: string, body: FormData, params: Record<string, string>): ActionFunctionArgs {
  return {
    request: new Request(url, { method: "POST", body }),
    context: { get: () => ({ env, ctx: null }) },
    params
  } as unknown as ActionFunctionArgs;
}

const registerArgs = (fields: Record<string, string>) =>
  args("https://web.test/portal/acme/register", form(fields), { tenantSlug: "acme" });

/* ----------------------------------------------------------- registration */

describe("registration kind", () => {
  it("only knows two answers, and defaults to the narrower one", () => {
    expect(registrationKind("business")).toBe("business");
    expect(registrationKind("person")).toBe("person");
    // A query string is public input: "admin", "staff" and null are all a person.
    expect(registrationKind("admin")).toBe("person");
    expect(registrationKind(null)).toBe("person");
  });
});

describe("register action", () => {
  it("sends a person as a person, and nothing a business would send", async () => {
    const calls = stubFetch(json({ status: "pending" }, 202));
    const result = await registerAction(
      registerArgs({
        kind: "person",
        name: "Layla Haddad",
        email: "layla@example.test",
        locale: "ar",
        consent: "on",
        "cf-turnstile-response": "tok"
      })
    );

    expect(result).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://api.test/v1/portal/acme/registrations");
    expect(calls[0]!.body).toEqual({
      kind: "person",
      name: "Layla Haddad",
      email: "layla@example.test",
      locale: "ar",
      consent: true,
      turnstileToken: "tok"
    });
  });

  it("omits a blank optional rather than sending an empty string", async () => {
    const calls = stubFetch(json({ status: "pending" }, 202));
    await registerAction(
      registerArgs({
        kind: "business",
        companyName: "Cedar Freight LLC",
        contactName: "Omar Nasser",
        registrationNo: "  ",
        taxId: "",
        country: "ae",
        email: "omar@cedar.test",
        phone: "",
        consent: "on"
      })
    );

    const body = calls[0]!.body;
    expect(body).not.toHaveProperty("registrationNo");
    expect(body).not.toHaveProperty("taxId");
    expect(body).not.toHaveProperty("phone");
    // Case is the server's to normalise; the form must not swallow the value.
    expect(body.country).toBe("ae");
    expect(body.kind).toBe("business");
    expect(body.companyName).toBe("Cedar Freight LLC");
  });

  it("never lets the form choose a tenant, a role or an entitlement", async () => {
    const calls = stubFetch(json({ status: "pending" }, 202));
    await registerAction(
      registerArgs({
        kind: "person",
        name: "Mallory",
        email: "mallory@example.test",
        consent: "on",
        tenantId: "ten_other",
        role: "owner",
        grants: '["*"]',
        kycStatus: "verified"
      })
    );

    // The body is built field by field from a fixed list; an extra input on the
    // page is not an extra field on the wire (and the API is `.strict()` anyway).
    expect(Object.keys(calls[0]!.body).sort()).toEqual(["consent", "email", "kind", "locale", "name"]);
    // The slug in the path is the only tenant selector, and it comes from the route.
    expect(calls[0]!.url).toContain("/portal/acme/");
  });

  it("tells a throttled visitor apart from a failed challenge", async () => {
    for (const [status, key] of [
      [429, "register.error.throttled"],
      [403, "register.error.challenge"],
      [400, "register.error.validation"],
      [500, "register.error.generic"]
    ] as const) {
      stubFetch(json({ error: "no" }, status));
      const result = await registerAction(
        registerArgs({ kind: "person", name: "A", email: "a@example.test", consent: "on" })
      );
      expect(result).toEqual({ ok: false, errorKey: key, invalid: [] });
      vi.unstubAllGlobals();
    }
  });

  // "Check the highlighted fields" was the copy long before anything was
  // highlighted. The API names them in `problem.errors` (apps/api/src/http.ts:33);
  // the action's job is only to carry the names across to the form.
  it("carries the fields the API rejected, so the form can mark them", async () => {
    stubFetch(
      json(
        { title: "Bad request", status: 400, errors: { email: "Invalid email", _: "and so on" } },
        400
      )
    );
    const result = await registerAction(
      registerArgs({ kind: "person", name: "A", email: "nope", consent: "on" })
    );
    // `_` names no input, so it is not something the form can point at.
    expect(result).toEqual({ ok: false, errorKey: "register.error.validation", invalid: ["email"] });
    vi.unstubAllGlobals();
  });
});

/* --------------------------------------------------------------- sliders */

describe("slider starting values", () => {
  const criteria = [
    { field: "age", kind: "number" as const, min: 18, max: 99, step: 1 },
    { field: "sumInsuredMinor", kind: "money" as const, min: 0, max: 20_000_000, step: 100_000 },
    { field: "priorClaims", kind: "boolean" as const, min: 0, max: 1, step: 1 }
  ];

  it("starts where the visitor's own answers are, in the server's units", () => {
    expect(initialValues(criteria, { age: 34, sumInsuredMinor: 5_500_000, priorClaims: true })).toEqual({
      age: 34,
      sumInsuredMinor: 5_500_000,
      priorClaims: true
    });
  });

  it("parks a missing or unusable answer mid-range instead of at NaN", () => {
    // A lead captured before a criterion existed has no value for it, and a
    // knob with no position renders an empty range the visitor cannot recover.
    expect(initialValues(criteria, { age: "thirty-four", priorClaims: "yes" })).toEqual({
      age: 59,
      sumInsuredMinor: 10_000_000,
      priorClaims: false
    });
  });

  it("carries nothing the panel does not rate on", () => {
    // inputs_json also holds vehicleUse, market and the lead's own answers. Only
    // declared criteria may round-trip through a public browser.
    expect(Object.keys(initialValues(criteria, { age: 40, vehicleUse: "private", market: "AE" }))).toEqual([
      "age",
      "sumInsuredMinor",
      "priorClaims"
    ]);
  });
});

describe("reprice action", () => {
  const quoteArgs = (fields: Record<string, string>) =>
    args("https://web.test/portal/acme/quotes/qr_1", form(fields), { tenantSlug: "acme", id: "qr_1" });

  it("asks the panel to price again and hands back what it said", async () => {
    const priced = {
      indicative: true,
      currency: "AED",
      rankedBy: "total_price",
      referredCount: 0,
      criteria: [],
      inputs: { age: 40 },
      offers: []
    };
    const calls = stubFetch(json(priced));
    const result = await quotesAction(
      quoteArgs({ intent: "reprice", token: "tok", inputs: JSON.stringify({ age: 40, priorClaims: true }) })
    );

    expect(calls[0]!.url).toBe("https://api.test/v1/portal/acme/quote-requests/qr_1/reprice");
    expect(calls[0]!.method).toBe("POST");
    // The browser sends criteria, never a price: there is no arithmetic on this
    // side of the wire to get wrong.
    expect(calls[0]!.body).toEqual({ token: "tok", inputs: { age: 40, priorClaims: true } });
    expect(result).toEqual({ intent: "reprice", ok: true, result: priced });
  });

  it("keeps the held prices on screen when the re-price fails", async () => {
    stubFetch(json({ error: "nope" }, 400));
    expect(await quotesAction(quoteArgs({ intent: "reprice", token: "tok", inputs: "{}" }))).toEqual({
      intent: "reprice",
      ok: false,
      errorKey: "quote.reprice.error"
    });

    vi.unstubAllGlobals();
    const calls = stubFetch(json({}));
    // A malformed payload is this page's own bug. It must not become a 500 on a
    // public page, and it must not reach the API either.
    expect(await quotesAction(quoteArgs({ intent: "reprice", token: "tok", inputs: "{oops" }))).toEqual({
      intent: "reprice",
      ok: false,
      errorKey: "quote.reprice.error"
    });
    expect(calls).toHaveLength(0);
  });

  it("still treats anything else as an accept", async () => {
    const calls = stubFetch(json({}));
    const result = await quotesAction(quoteArgs({ token: "tok", offeringId: "off_1" }));
    expect(calls[0]!.url).toBe("https://api.test/v1/portal/acme/quote-requests/qr_1/accept");
    expect(result).toEqual({ intent: "accept", ok: true });
  });
});
