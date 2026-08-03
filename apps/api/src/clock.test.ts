import { describe, expect, it } from "vitest";
import { simNow } from "./clock.js";
import type { Env } from "./env.js";

// The virtual clock (docs/24 sim plan). Production must never see a staged
// offset; a non-production deployment with one staged must apply it.

function kvWith(offsetMs: number | null): Env["CONFIG"] {
  return {
    async get(key: string) {
      return key === "sim:clock:offsetMs" && offsetMs !== null ? String(offsetMs) : null;
    }
  } as unknown as Env["CONFIG"];
}

describe("simNow", () => {
  it("returns the real clock in production, even with an offset staged", async () => {
    const env = { ENVIRONMENT: "production", CONFIG: kvWith(86_400_000) } as unknown as Env;
    const before = Date.now();
    const now = await simNow(env);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThan(before + 1000);
  });

  it("applies the staged offset outside production", async () => {
    const env = { ENVIRONMENT: "staging", CONFIG: kvWith(86_400_000) } as unknown as Env;
    const before = Date.now();
    const now = await simNow(env);
    expect(now).toBeGreaterThanOrEqual(before + 86_400_000);
  });

  it("falls back to the real clock outside production with no offset staged", async () => {
    const env = { ENVIRONMENT: "staging", CONFIG: kvWith(null) } as unknown as Env;
    const before = Date.now();
    const now = await simNow(env);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThan(before + 1000);
  });

  it("falls back to the real clock when CONFIG isn't bound", async () => {
    const env = { ENVIRONMENT: "staging" } as unknown as Env;
    const before = Date.now();
    const now = await simNow(env);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThan(before + 1000);
  });
});
