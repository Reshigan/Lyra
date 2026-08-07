import { describe, expect, it } from "vitest";
import { incurred } from "./claims.js";

describe("claim incurred", () => {
  it("is paid plus outstanding reserve less recoveries", () => {
    expect(incurred({ paidMinor: 0, reserveMinor: 500_000, recoveredMinor: 0 })).toBe(500_000);
    // Part-paid: the reserve is what is left standing, so the total holds.
    expect(incurred({ paidMinor: 200_000, reserveMinor: 300_000, recoveredMinor: 0 })).toBe(500_000);
    // A recovery reduces the net cost of the claim, not the amount paid out.
    expect(incurred({ paidMinor: 500_000, reserveMinor: 0, recoveredMinor: 120_000 })).toBe(380_000);
    // Recovering more than was paid is a negative incurred — real, and it must
    // not be clamped, or the loss ratio quietly overstates.
    expect(incurred({ paidMinor: 100_000, reserveMinor: 0, recoveredMinor: 150_000 })).toBe(-50_000);
  });
});
