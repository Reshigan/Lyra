/**
 * The hero counts a headline figure up from zero, which means parsing a
 * tenant-supplied string with a regex. CodeQL js/polynomial-redos (alert 12)
 * flagged the first version: `\D*` and `[\d,]+` both match a comma, so a value
 * of nothing but commas made them fight over every character.
 */
import { describe, expect, it } from "vitest";
import { HEADLINE_NUMERAL } from "./hero.js";

describe("HEADLINE_NUMERAL", () => {
  it("splits a real headline into prefix, numeral and suffix", () => {
    expect(HEADLINE_NUMERAL.exec("AED 1,240,500")?.slice(1)).toEqual(["AED ", "1,240,500", ""]);
    expect(HEADLINE_NUMERAL.exec("4.2m")?.slice(1)).toEqual(["", "4.2", "m"]);
    expect(HEADLINE_NUMERAL.exec("98.5%")?.slice(1)).toEqual(["", "98.5", "%"]);
  });

  it("declines a value with no numeral rather than inventing one", () => {
    expect(HEADLINE_NUMERAL.exec("no data yet")).toBeNull();
  });

  it("stays linear on the string that made the old pattern backtrack", () => {
    // 50k commas: under the old `\D*` prefix this is quadratic. Anything that
    // reintroduces the overlap blows the budget rather than merely slowing.
    const hostile = ",".repeat(50_000) + "x";
    const started = performance.now();
    HEADLINE_NUMERAL.exec(hostile);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
