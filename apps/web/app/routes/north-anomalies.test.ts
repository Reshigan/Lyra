import { beforeEach, describe, expect, it, vi } from "vitest";
import { driverWidth, headline, tone } from "./north-anomalies";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-anomalies";

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

describe("headline", () => {
  const l = (key: string) => key;

  it("says access is missing when the list could not be read", () => {
    expect(headline(null, l)).toBe("headline.denied");
  });

  it("says nothing moved when the list is empty", () => {
    expect(headline([], l)).toBe("headline.clear");
  });

  it("flags an unowned anomaly even when others are already closed", () => {
    expect(headline([{ state: "explained" }, { state: "new" }], l)).toBe("headline.open");
  });

  it("says every anomaly has an owner when none are unowned", () => {
    expect(headline([{ state: "explained" }, { state: "dismissed" }], l)).toBe("headline.owned");
  });
});

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-anomalies loader asOf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends &to=<asOf> to the anomalies query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/anomalies?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const anomaliesCall = vi.mocked(api).mock.calls[0]?.[0] as string;
    expect(anomaliesCall).toContain("&to=1700000000000");
  });

  it("omits &to= when ?asOf= is absent", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/anomalies"),
      context: fakeContext()
    } as never);
    const anomaliesCall = vi.mocked(api).mock.calls[0]?.[0] as string;
    expect(anomaliesCall).not.toContain("&to=");
  });
});
