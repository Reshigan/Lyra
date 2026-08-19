import { describe, expect, it } from "vitest";

import { InstantMsParam, IsoMonth, instantParam, monthRangeMs } from "./http.js";

describe("monthRangeMs", () => {
  // `Date.UTC(y, m - 1, 1)` maps years 0-99 onto 1900-1999, so a bordereau or a
  // settlement labelled 0050-06 summed June *1950*. Both engines had hand-rolled
  // that shape; `Date.parse` on the ISO string has no century mapping.
  it("does not map a two-digit year into the twentieth century", () => {
    const { start, end } = monthRangeMs("0050-06");
    expect(new Date(start).toISOString()).toBe("0050-06-01T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("0050-07-01T00:00:00.000Z");
  });

  it("rolls December into the next January", () => {
    const { start, end } = monthRangeMs("2026-12");
    expect(new Date(start).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is half-open on an ordinary month", () => {
    const { start, end } = monthRangeMs("2026-02");
    expect(new Date(start).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("IsoMonth", () => {
  it("accepts a real month and refuses a thirteenth", () => {
    expect(IsoMonth.safeParse("2026-01").success).toBe(true);
    expect(IsoMonth.safeParse("2026-13").success).toBe(false);
    expect(IsoMonth.safeParse("2026-00").success).toBe(false);
    expect(IsoMonth.safeParse("2026-1").success).toBe(false);
  });
});

describe("InstantMsParam", () => {
  // The band (8.64e15, 9.007e15] is a safe integer but not an instant any
  // `Date` can hold, so `z.coerce.number().int()` let it through to SQL.
  it("coerces a string and holds the Date bound", () => {
    expect(InstantMsParam.parse("1700000000000")).toBe(1_700_000_000_000);
    expect(InstantMsParam.safeParse("9000000000000000").success).toBe(false);
    expect(InstantMsParam.safeParse("abc").success).toBe(false);
  });
});

describe("instantParam", () => {
  it("leaves a blank parameter to the endpoint's own default", () => {
    expect(instantParam(undefined)).toBeUndefined();
    expect(instantParam("")).toBeUndefined();
  });
});
