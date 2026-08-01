import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { action } from "./settings";

// Tenant branding is the one place a form can make text unreadable across every
// screen in the tenant, so the AA check runs on the server. Both fills carry the
// same label — hovering a button does not recolour its text — so both are checked.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubApi() {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null });
    const body = url.includes("/v1/me") ? { id: "usr_01", permissions: [], roles: [], tenant: { id: "t1" } } : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  return calls;
}

function args(palette: Record<string, string>): any {
  return {
    request: new Request("https://web.test/settings", {
      method: "POST",
      body: new URLSearchParams({ intent: "brand", ...palette })
    }),
    params: {},
    context: { get: () => ({ env, ctx: {} }) }
  };
}

const CONTRAST = "#070b14";

describe("brand colours are checked against AA before they are saved", () => {
  it("refuses a hover fill that fails on the label colour, and saves nothing", async () => {
    const calls = stubApi();
    // 4.28:1 — the accent itself passes at 6.22:1, so only the hover state fails.
    const result = await action(args({ accent: "#5B8CFF", accentHover: "#3F6FE0", accentContrast: CONTRAST }));
    expect(result).toMatchObject({ intent: "brand", errorKey: "brand.contrastFail" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("refuses an accent that fails even when the hover state passes", async () => {
    const calls = stubApi();
    const result = await action(args({ accent: "#1B3A8C", accentHover: "#7FA6FF", accentContrast: CONTRAST }));
    expect(result).toMatchObject({ intent: "brand", errorKey: "brand.contrastFail" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("saves a palette where both fills clear the bar", async () => {
    const calls = stubApi();
    // #5B8CFF/#7FA6FF clear the button-label bar (vs CONTRAST) but fail the
    // link-text bar (vs white, 2.94:1/4.20:1) — this pair clears both.
    const result = await action(args({ accent: "#3762C4", accentHover: "#2A4FA0", accentContrast: "#ffffff" }));
    expect(result).toMatchObject({ intent: "brand", ok: true });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}").brandJson.palette).toEqual({
      accent: "#3762C4",
      accentHover: "#2A4FA0",
      accentContrast: "#ffffff"
    });
  });

  it("refuses an accent that reads fine as a button label but fails as link text on white", async () => {
    const calls = stubApi();
    const result = await action(args({ accent: "#5B8CFF", accentHover: "#7FA6FF", accentContrast: CONTRAST }));
    expect(result).toMatchObject({ intent: "brand", errorKey: "brand.contrastFail" });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});
