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

function args(calendar: string): any {
  return {
    request: new Request("https://web.test/settings", {
      method: "POST",
      body: new URLSearchParams({ intent: "calendar", calendar })
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
