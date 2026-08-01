import { describe, expect, it } from "vitest";
import { checkKAnonymity, DEFAULT_K_FLOOR } from "./k-anonymity.js";

describe("checkKAnonymity", () => {
  it("suppresses a cell below the floor", () => {
    const result = checkKAnonymity(19, 20);
    expect(result).toEqual({ allowed: false, cellCount: 19, floor: 20 });
  });

  it("passes a cell exactly at the floor (boundary)", () => {
    const result = checkKAnonymity(20, 20);
    expect(result.allowed).toBe(true);
  });

  it("passes a cell above the floor", () => {
    expect(checkKAnonymity(21, 20).allowed).toBe(true);
  });

  it("honours a product-specific floor, not just the default", () => {
    expect(checkKAnonymity(41, 50).allowed).toBe(false); // Gulf Health cut from the seed narrative
    expect(checkKAnonymity(50, 50).allowed).toBe(true);
  });

  it("defaults to k=20 per docs/modules/scout.md §2.5", () => {
    expect(DEFAULT_K_FLOOR).toBe(20);
  });
});
