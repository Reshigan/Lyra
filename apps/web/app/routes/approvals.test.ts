import { describe, expect, it } from "vitest";
import { policyTitle } from "./approvals";

// Every card in the queue was headed by the policy key as stored —
// `axis.claim_payment` — where the thing being approved belongs.

describe("policyTitle", () => {
  it("drops the module the card already names", () => {
    expect(policyTitle("axis.claim_payment", "axis")).toBe("Claim payment");
  });

  it("keeps a prefix that is not this row's module", () => {
    expect(policyTitle("ledger.refund", "axis")).toBe("Ledger refund");
  });

  it("reads a key with no prefix at all", () => {
    expect(policyTitle("payout_release", "core")).toBe("Payout release");
  });
});
