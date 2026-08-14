import { describe, expect, it } from "vitest";
import { deltaBps, headlineDirection } from "./north-explorer";

describe("deltaBps", () => {
  it("has no change to report with fewer than two snapshots", () => {
    expect(deltaBps([])).toBeNull();
    expect(deltaBps([100])).toBeNull();
  });

  it("reads the change of the last snapshot on the one before it", () => {
    expect(deltaBps([100, 110])).toBe(1000);
    expect(deltaBps([50, 100, 110])).toBe(1000);
    expect(deltaBps([100, 90])).toBe(-1000);
  });

  it("refuses to divide by a zero prior rather than reporting infinity", () => {
    expect(deltaBps([0, 42])).toBeNull();
  });

  it("keeps the direction of the move when the prior was negative", () => {
    // A loss shrinking from -100 to -50 is an improvement of 50%, not -50%.
    expect(deltaBps([-100, -50])).toBe(5000);
  });
});

describe("headlineDirection", () => {
  it("has nothing to headline with fewer than two snapshots", () => {
    expect(headlineDirection([])).toBeNull();
    expect(headlineDirection([100])).toBeNull();
  });

  it("names the direction the last two snapshots moved", () => {
    expect(headlineDirection([100, 110])).toBe("up");
    expect(headlineDirection([100, 90])).toBe("down");
  });

  it("reports nothing rather than a trend that isn't there", () => {
    expect(headlineDirection([100, 100])).toBeNull();
  });
});
