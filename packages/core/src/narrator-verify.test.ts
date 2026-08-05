import { describe, expect, it } from "vitest";
import { verifyGroundedness } from "./narrator-verify.js";

describe("verifyGroundedness", () => {
  it("passes text whose numbers all trace back to the context", () => {
    const result = verifyGroundedness(
      "The claim is valued at 5000 AED and was opened on 2026-01-05.",
      ["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."]
    );
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it("flags a number the context never gave it", () => {
    const result = verifyGroundedness(
      "The claim is valued at 99999 AED.",
      ["Case CAS-1: kind claim, status review, priority high, opened 2026-01-05, value 5000 AED."]
    );
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([99999]);
  });

  it("passes text with no numeric claims at all", () => {
    const result = verifyGroundedness("This case looks routine.", ["Case CAS-1: kind claim, status review."]);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });
});
