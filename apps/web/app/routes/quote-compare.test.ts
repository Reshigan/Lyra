import { describe, expect, it } from "vitest";
import { requestExpired } from "./quote-compare";

describe("requestExpired", () => {
  it("is false when the request never expires", () => {
    expect(requestExpired(null, 1_000)).toBe(false);
  });

  it("is false before the expiry", () => {
    expect(requestExpired(2_000, 1_000)).toBe(false);
  });

  it("is true at and after the expiry", () => {
    expect(requestExpired(1_000, 1_000)).toBe(true);
    expect(requestExpired(1_000, 2_000)).toBe(true);
  });
});
