import { describe, expect, it } from "vitest";
import { adapterFor } from "./orbit-channel-adapters.js";

describe("adapterFor", () => {
  it("resolves the whatsapp cloud adapter", () => {
    expect(adapterFor("whatsapp-cloud-api").transport).toBe("whatsapp");
  });

  it("resolves the mailgun email adapter", () => {
    expect(adapterFor("mailgun-email").transport).toBe("email");
  });

  it("throws for an unknown provider", () => {
    expect(() => adapterFor("carrier-pigeon")).toThrow();
  });
});
