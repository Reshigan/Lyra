import { describe, expect, it } from "vitest";
import { detailHeadlineKey } from "./settlement-detail";

describe("detailHeadlineKey", () => {
  it("flags a ledger mismatch even when a decision is open", () => {
    expect(detailHeadlineKey(false, 2)).toBe("mismatch");
  });

  it("calls out an open decision when the net holds", () => {
    expect(detailHeadlineKey(true, 1)).toBe("actionable");
  });

  it("falls back to a plain readout once nothing is open", () => {
    expect(detailHeadlineKey(true, 0)).toBe("plain");
  });
});
