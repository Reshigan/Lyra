import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";

describe("password", () => {
  it("round-trips and rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong horse battery", stored)).toBe(false);
    expect(await verifyPassword("correct horse battery", null)).toBe(false);
    expect(await verifyPassword("correct horse battery", "not-a-hash")).toBe(false);
  });

  it("never asks the runtime for more than 100k iterations in one call", async () => {
    // The Workers runtime throws above 100k. Miniflare and Node do not, so the
    // ceiling has to be asserted here or the failure only shows up in production.
    const real = crypto.subtle.deriveBits.bind(crypto.subtle);
    const seen: number[] = [];
    crypto.subtle.deriveBits = ((algo: { iterations?: number }, ...rest: unknown[]) => {
      seen.push(algo.iterations ?? 0);
      return real(algo as Parameters<typeof real>[0], ...(rest as [CryptoKey, number]));
    }) as typeof crypto.subtle.deriveBits;
    try {
      const stored = await hashPassword("correct horse battery");
      expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    } finally {
      crypto.subtle.deriveBits = real;
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(100_000);
    expect(seen.reduce((a, b) => a + b, 0) / 2).toBe(210_000);
  });

  it("flags hashes cheaper than the current cost", async () => {
    expect(needsRehash("pbkdf2$1000$aaaa$bbbb")).toBe(true);
    expect(needsRehash(await hashPassword("correct horse battery"))).toBe(false);
  });
});
