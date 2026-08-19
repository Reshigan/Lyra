import { describe, expect, it } from "vitest";
import { bodyFrom, inputValue, type FieldSpec } from "./spec";

// Commission, discount, tax and FX are all stored in parts per million. Typed
// straight into a number box that meant "40" and stored "40", a 40% commission
// became 0.004%, which is a money bug wearing a formatting bug's clothes.

const rate: FieldSpec = { name: "defaultCommissionPpm", type: "rate" };
const ratio: FieldSpec = { name: "ratePpm", type: "ratio" };

const form = (name: string, value: string): FormData => {
  const data = new FormData();
  data.set(name, value);
  return data;
};

describe("a share the form writes as a percentage", () => {
  it("shows the stored millionths as the percentage a person typed", () => {
    expect(inputValue(rate, { defaultCommissionPpm: 400_000 })).toBe("40");
    expect(inputValue(rate, { defaultCommissionPpm: 27_500 })).toBe("2.75");
  });

  it("stores the percentage back as millionths", () => {
    expect(bodyFrom([rate], form("defaultCommissionPpm", "40"))).toEqual({
      defaultCommissionPpm: 400_000
    });
    expect(bodyFrom([rate], form("defaultCommissionPpm", "2.75"))).toEqual({
      defaultCommissionPpm: 27_500
    });
  });

  it("survives the round trip it will actually make", () => {
    const stored = 123_456;
    const typed = inputValue(rate, { defaultCommissionPpm: stored });
    expect(bodyFrom([rate], form("defaultCommissionPpm", typed))).toEqual({
      defaultCommissionPpm: stored
    });
  });

  it("writes nothing rather than NaN when the box holds nonsense", () => {
    expect(bodyFrom([rate], form("defaultCommissionPpm", "abc"))).toEqual({});
  });
});

/**
 * The generic edit form renders every module's records, so it meets the oldest
 * rows in the tables — including instants written before `InstantMs` bounded
 * the write surfaces, which `toISOString` refuses with `RangeError`. Thrown
 * here it takes the record screen, not the field.
 */
describe("a date the form has to put in a date box", () => {
  const when: FieldSpec = { name: "endAt", type: "date" };

  it("blanks the box rather than throwing on an instant no Date can hold", () => {
    expect(inputValue(when, { endAt: 9e15 })).toBe("");
  });

  it("still shows a date the box can hold", () => {
    expect(inputValue(when, { endAt: 1_786_424_878_339 })).toBe("2026-08-11");
  });
});

describe("a multiplier the form writes as itself", () => {
  it("keeps an FX rate a rate", () => {
    expect(inputValue(ratio, { ratePpm: 18_500_000 })).toBe("18.5");
    expect(bodyFrom([ratio], form("ratePpm", "18.5"))).toEqual({ ratePpm: 18_500_000 });
  });
});
