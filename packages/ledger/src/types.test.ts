import { describe, expect, it } from "vitest";
import { txnType } from "./types.js";

describe("PLAN-CREATE txn type", () => {
  it("is registered as non-financial with no approval gate", () => {
    const t = txnType("PLAN-CREATE");
    expect(t.financial).toBe(false);
    expect(t.approval).toBeNull();
  });
});
