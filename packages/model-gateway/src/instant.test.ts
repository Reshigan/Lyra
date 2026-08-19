import { describe, expect, it } from "vitest";
import { isoDay, promptInstant } from "./instant.js";

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

describe("isoDay", () => {
  it("renders the day of a normal instant", () => {
    expect(isoDay(1_781_571_600_000)).toBe("2026-06-16");
  });

  it('degrades to "unknown" rather than throwing', () => {
    expect(isoDay(9e15)).toBe("unknown");
  });

  // Not `slice(0, 10)`: an in-range instant far enough from now renders as
  // `-251540-02-03T09:46:40.000Z`, and ten characters of that is `-251540-02` —
  // a month with no day, presented as if it were a whole date.
  it("keeps the whole day of an instant whose year is not four digits", () => {
    expect(isoDay(-8e15)).toBe("-251540-02-03");
  });
});
