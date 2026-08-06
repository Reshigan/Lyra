import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { action } from "./settings";

// Tenant policy is one JSON column, so saving a calendar means writing the whole
// blob back. The rest of the policy — autoApprove above all — must survive that
// round trip untouched: a settings form that quietly empties the approval
// allowlist would automate every consequential action in the tenant.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

const POLICY = {
  autoApprove: ["axis.bind"],
  currency: "AED",
  locales: ["en", "ar"],
  defaultLocale: "en",
  domainPack: "insurance-retail",
  calendarPreference: "gregorian"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi() {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null });
    const body = url.includes("/v1/me")
      ? { id: "usr_01", permissions: [], roles: [], tenant: { id: "t1" }, policy: POLICY }
      : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  return calls;
}

function args(calendar: string, extra: Record<string, string> = {}): any {
  return {
    request: new Request("https://web.test/settings", {
      method: "POST",
      body: new URLSearchParams({ intent: "calendar", calendar, ...extra })
    }),
    params: {},
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("the tenant's calendar is editable without disturbing the rest of policy", () => {
  it("saves the choice and carries every other policy field through", async () => {
    const calls = stubApi();
    const result = await action(args("islamic-umalqura"));
    expect(result).toMatchObject({ intent: "calendar", ok: true });

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("/v1/core/tenants/t1");
    expect(JSON.parse(patch?.body ?? "{}").policyJson).toEqual({
      ...POLICY,
      calendarPreference: "islamic-umalqura"
    });
  });

  it("refuses a calendar it does not render, rather than storing it", async () => {
    const calls = stubApi();
    const result = await action(args("julian"));
    expect(result).toMatchObject({ intent: "calendar", errorKey: "calendar.unknown" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

// The same panel owns the two other tenant-wide regional settings the UI reads
// but nothing could edit: which locale a tenant defaults to, and the currency
// every money figure is written in.
describe("the tenant's default locale and currency are editable there too", () => {
  it("saves both, and leaves the rest of policy alone", async () => {
    const calls = stubApi();
    const result = await action(args("gregorian", { defaultLocale: "ar", currency: "sar" }));
    expect(result).toMatchObject({ intent: "calendar", ok: true });

    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}").policyJson).toEqual({
      ...POLICY,
      calendarPreference: "gregorian",
      defaultLocale: "ar",
      currency: "SAR"
    });
  });

  it("refuses a default locale the tenant does not run in", async () => {
    const calls = stubApi();
    const result = await action(args("gregorian", { defaultLocale: "fr" }));
    expect(result).toMatchObject({ intent: "calendar", errorKey: "calendar.localeUnknown" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("refuses anything that is not a three-letter currency code", async () => {
    const calls = stubApi();
    const result = await action(args("gregorian", { currency: "dirhams" }));
    expect(result).toMatchObject({ intent: "calendar", errorKey: "calendar.currencyBad" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("leaves both untouched when the form omits them", async () => {
    const calls = stubApi();
    await action(args("dual"));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}").policyJson).toMatchObject({
      defaultLocale: "en",
      currency: "AED"
    });
  });
});
