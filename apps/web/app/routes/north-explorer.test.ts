import { beforeEach, describe, expect, it, vi } from "vitest";
import { deltaBps, headlineDirection } from "./north-explorer";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-explorer";

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

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-explorer loader asOf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends &to=<asOf> to the snapshots query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValueOnce({ data: [{ key: "gwp", grain: "day" }] });
    vi.mocked(api).mockResolvedValueOnce({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/explorer?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const snapshotsCall = vi.mocked(api).mock.calls[1]?.[0] as string;
    expect(snapshotsCall).toContain("&to=1700000000000");
  });

  it("omits &to= when ?asOf= is absent", async () => {
    vi.mocked(api).mockResolvedValueOnce({ data: [{ key: "gwp", grain: "day" }] });
    vi.mocked(api).mockResolvedValueOnce({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/explorer"),
      context: fakeContext()
    } as never);
    const snapshotsCall = vi.mocked(api).mock.calls[1]?.[0] as string;
    expect(snapshotsCall).not.toContain("&to=");
  });
});
