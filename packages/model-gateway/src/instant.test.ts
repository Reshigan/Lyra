import { describe, expect, it } from "vitest";
import { promptInstant } from "./instant.js";

describe("promptInstant", () => {
  it("renders a normal instant as ISO-8601", () => {
    expect(promptInstant(1_781_571_600_000)).toBe("2026-06-16T01:00:00.000Z");
  });

  // Total, because every caller sits inside a `catch {}` that turns a throw into
  // a silently disabled feature — `scoreFraud` stops scoring the claim entirely.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["1e17, past the Date range", 1e17],
    ["-1e17, before the Date range", -1e17]
  ])('returns "unknown" for %s rather than throwing', (_label, ms) => {
    expect(promptInstant(ms)).toBe("unknown");
  });

  it("still renders the last instant a Date can hold", () => {
    expect(promptInstant(8.64e15)).toBe("+275760-09-13T00:00:00.000Z");
  });
});
