import { beforeEach, describe, expect, it, vi } from "vitest";
import { firstSentence } from "./north-brief";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { api } from "../api.server";
import { loader } from "./north-brief";

describe("firstSentence", () => {
  it("has nothing to headline with when there is no paragraph", () => {
    expect(firstSentence(undefined)).toBeNull();
  });

  it("takes the first sentence off a multi-sentence paragraph", () => {
    expect(firstSentence("Revenue moved up. Costs held flat. Margin improved.")).toBe(
      "Revenue moved up."
    );
  });

  it("keeps the whole paragraph when it has no sentence break", () => {
    expect(firstSentence("Revenue moved up")).toBe("Revenue moved up");
  });

  it("splits on ! and ? as well as .", () => {
    expect(firstSentence("Margin spiked! Nobody expected that.")).toBe("Margin spiked!");
    expect(firstSentence("Is this real? Yes, it is.")).toBe("Is this real?");
  });
});

function fakeContext() {
  return { get: () => ({ env: {} }) };
}

describe("north-brief loader asOf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends &to=<asOf> to every query when ?asOf= is present", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/brief?asOf=1700000000000"),
      context: fakeContext()
    } as never);
    const calledPaths = vi.mocked(api).mock.calls.map(([path]) => path as string);
    expect(calledPaths.every((path) => path.includes("&to=1700000000000"))).toBe(true);
  });

  it("omits &to= when ?asOf= is absent (live mode, unchanged behavior)", async () => {
    vi.mocked(api).mockResolvedValue({ data: [] });
    await loader({
      request: new Request("https://lyra.test/north/brief"),
      context: fakeContext()
    } as never);
    const calledPaths = vi.mocked(api).mock.calls.map(([path]) => path as string);
    expect(calledPaths.every((path) => !path.includes("&to="))).toBe(true);
  });
});
