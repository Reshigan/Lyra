import { describe, expect, it } from "vitest";
import { txnType } from "./types.js";

describe("PLAN-CREATE txn type", () => {
  it("is registered as non-financial with no approval gate", () => {
    const t = txnType("PLAN-CREATE");
    expect(t.financial).toBe(false);
    expect(t.approval).toBeNull();
  });
});

describe("TELEM-INGEST txn type", () => {
  it("is registered as non-financial with no approval gate", () => {
    const t = txnType("TELEM-INGEST");
    expect(t.financial).toBe(false);
    expect(t.approval).toBeNull();
  });
});

describe("UBI-REPRICE txn type", () => {
  it("is registered as financial and reuses the endorsement approval gate", () => {
    const t = txnType("UBI-REPRICE");
    expect(t.financial).toBe(true);
    expect(t.approval).toBe("axis.endorse");
  });
});
