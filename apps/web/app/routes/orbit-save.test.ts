import { describe, expect, it } from "vitest";
import { labelsIn } from "./orbit-save";

describe("labelsIn", () => {
  it("lets the tenant's pack rename the agreement reference", () => {
    // The queue's second column is `policyRef`, which the pack owns; the desk
    // used to head it "Policy reference" on a retail tenant.
    expect(labelsIn("en", "retail-ecom")("policyRef")).toBe("Order reference");
    expect(labelsIn("ar", "retail-ecom")("policyRef")).toBe("مرجع الطلب");
  });

  it("keeps its own words, which no pack has an opinion on", () => {
    expect(labelsIn("en")("policyRef")).not.toBe("Order reference");
    expect(labelsIn("en")("customer")).toBeTruthy();
  });
});
