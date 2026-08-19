import { describe, expect, it } from "vitest";
import { labeller, requestExpired } from "./quote-compare";

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

describe("labeller", () => {
  it("lets the tenant's pack rename the offer noun", () => {
    // Without the pack this screen titled a reorder "Renewal" on a retail
    // tenant — the route table answered before anyone asked the pack.
    expect(labeller("en", "retail-ecom")("kind.renewal")).toBe("Reorder");
    expect(labeller("ar", "retail-ecom")("kind.renewal")).toBe("إعادة طلب");
  });

  it("keeps the insurance wording when no pack renames it", () => {
    expect(labeller("en")("kind.renewal")).toBe("Renewal");
    expect(labeller("en", "insurance-retail")("kind.renewal")).toBe("Renewal");
  });

  it("still answers its own keys, which no pack has an opinion on", () => {
    expect(labeller("en")("title")).toBe("Quote comparison");
  });
});
