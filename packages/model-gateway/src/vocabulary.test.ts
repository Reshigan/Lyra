import { describe, expect, it } from "vitest";
import { DEFAULT_PACK, promptNouns } from "./vocabulary.js";

describe("promptNouns", () => {
  it("reads the pack's nouns", () => {
    expect(promptNouns("retail-ecom")).toEqual({ domain: "retail commerce", contract: "order", contracts: "orders" });
  });

  it("defaults an absent pack", () => {
    expect(promptNouns(undefined)).toEqual(promptNouns(DEFAULT_PACK));
  });

  it("defaults an unknown pack rather than yielding an empty noun", () => {
    expect(promptNouns("not-a-pack")).toEqual(promptNouns(DEFAULT_PACK));
  });

  it("never returns a blank noun for any known pack", () => {
    for (const pack of [DEFAULT_PACK, "retail-ecom", "health-provider", "lending-credit"]) {
      const nouns = promptNouns(pack);
      expect(nouns.domain.trim()).not.toBe("");
      expect(nouns.contract.trim()).not.toBe("");
      expect(nouns.contracts.trim()).not.toBe("");
    }
  });

  it("does not let a prototype key through as a pack", () => {
    expect(promptNouns("__proto__")).toEqual(promptNouns(DEFAULT_PACK));
    expect(promptNouns("constructor")).toEqual(promptNouns(DEFAULT_PACK));
  });
});
