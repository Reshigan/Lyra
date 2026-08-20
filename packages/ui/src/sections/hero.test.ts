/**
 * The hero counts a headline figure up from zero, which means parsing a
 * tenant-supplied string with a regex. CodeQL js/polynomial-redos flagged two
 * versions of it: `\D*` and `[\d,]+` both match a comma (alert 12), and then a
 * trailing `(.*)$` that fails on a newline sends the engine back to retry every
 * shorter numeral (alert 13). The pattern now ends at the numeral and the caller
 * slices the suffix.
 */
import { describe, expect, it } from "vitest";
import { splitHeadline } from "./hero.js";

describe("splitHeadline", () => {
  it("splits a real headline into prefix, numeral and suffix", () => {
    expect(splitHeadline("AED 1,240,500")).toEqual({ prefix: "AED ", numStr: "1,240,500", suffix: "" });
    expect(splitHeadline("4.2m")).toEqual({ prefix: "", numStr: "4.2", suffix: "m" });
    expect(splitHeadline("98.5%")).toEqual({ prefix: "", numStr: "98.5", suffix: "%" });
    expect(splitHeadline("$12")).toEqual({ prefix: "$", numStr: "12", suffix: "" });
  });

  it("declines a value with no numeral rather than inventing one", () => {
    expect(splitHeadline("no data yet")).toBeUndefined();
    expect(splitHeadline("")).toBeUndefined();
  });

  it("stays linear on the strings that made the old patterns backtrack", () => {
    // 50k commas, and the same again with a newline the old `(.*)$` could not
    // cross. Either overlap reintroduced blows the budget rather than merely
    // slowing.
    for (const hostile of [",".repeat(50_000) + "x", ",".repeat(50_000) + "\n"]) {
      const started = performance.now();
      splitHeadline(hostile);
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });

  it("keeps a suffix that contains a newline", () => {
    expect(splitHeadline("12\nrows")).toEqual({ prefix: "", numStr: "12", suffix: "\nrows" });
  });
});
