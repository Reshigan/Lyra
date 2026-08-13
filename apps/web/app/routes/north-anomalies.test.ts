import { describe, expect, it } from "vitest";
import { driverWidth, tone } from "./north-anomalies";

const drivers = [
  { dimension: "channel", key: "alpha-brokers", contributionBps: -1180 },
  { dimension: "channel", key: "direct", contributionBps: 590 }
];

describe("driverWidth", () => {
  it("gives the widest contributor the full bar", () => {
    expect(driverWidth(-1180, drivers)).toBe(100);
  });

  it("scales the rest against that widest one, on magnitude not sign", () => {
    expect(driverWidth(590, drivers)).toBe(50);
  });

  it("draws nothing rather than dividing by zero when every driver is flat", () => {
    expect(driverWidth(0, [{ dimension: "channel", key: "x", contributionBps: 0 }])).toBe(0);
    expect(driverWidth(0, [])).toBe(0);
  });
});

describe("tone", () => {
  it("reads a rise as good for a metric that is meant to go up", () => {
    expect(tone(1200, "up")).toBe("ok");
    expect(tone(-1200, "up")).toBe("bad");
  });

  it("inverts for a metric that is meant to go down — a cost, a handling time", () => {
    expect(tone(-1200, "down")).toBe("ok");
    expect(tone(1200, "down")).toBe("bad");
  });

  it("treats an unknown direction as up rather than guessing", () => {
    expect(tone(1200, undefined)).toBe("ok");
  });

  it("has no opinion on a metric that did not move", () => {
    expect(tone(0, "down")).toBe("neutral");
  });
});
