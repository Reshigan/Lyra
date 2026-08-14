import { describe, expect, it } from "vitest";
import { deliveryLabel } from "./conversation";

const l = (key: string) => key;

describe("deliveryLabel", () => {
  it("says a turn was never dispatched", () => {
    expect(deliveryLabel(null, l)).toBe("delivery.none");
  });

  it("translates a known status", () => {
    expect(deliveryLabel("queued", l)).toBe("delivery.queued");
    expect(deliveryLabel("delivered", l)).toBe("delivery.delivered");
  });

  it("echoes an unknown status raw rather than guessing", () => {
    expect(deliveryLabel("bounced", l)).toBe("bounced");
  });
});
