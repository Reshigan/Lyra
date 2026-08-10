import { describe, expect, it, vi } from "vitest";
import { dispatch } from "./lyra.js";
import { stagingSmoke } from "./lyra-staging.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("stagingSmoke", () => {
  it("reports unauth checks and one authenticated read per module", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/auth/demo/login")) return jsonResponse(200, { token: "tok-123" });
      if (u.endsWith("/health")) return jsonResponse(200, { ok: true });
      if (u === "https://staging.example" && init?.redirect === "manual") {
        return new Response(null, { status: 302 });
      }
      if (u.endsWith("/login")) return new Response("ok", { status: 200 });
      // every module's authenticated GET
      return jsonResponse(200, { items: [] });
    });

    const report = await stagingSmoke({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiOrigin: "https://api-staging.example",
      webOrigin: "https://staging.example"
    });

    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.checks.map((c) => c.name)).toContain("core:approvals (approval-gate)");
    expect(report.checks.map((c) => c.name)).toContain("analytics:exports (export)");
  });

  it("marks a module check as failed when the demo login itself fails", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/v1/auth/demo/login")) return jsonResponse(404, { error: "route not found" });
      if (u.endsWith("/health")) return jsonResponse(200, { ok: true });
      if (u.endsWith("/login")) return new Response("ok", { status: 200 });
      if (u === "https://staging.example") return new Response(null, { status: 302 });
      return jsonResponse(200, { items: [] });
    });

    const report = await stagingSmoke({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiOrigin: "https://api-staging.example",
      webOrigin: "https://staging.example"
    });

    expect(report.checks.some((c) => !c.ok)).toBe(true);
  });
});

describe("dispatch staging smoke", () => {
  it("routes an unknown staging subcommand to a usage error", async () => {
    const result = await dispatch(["staging", "bogus"]);
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/unknown staging subcommand "bogus"/);
  });
});
