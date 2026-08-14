import { describe, expect, it } from "vitest";
import { statementHeadline } from "./commission-statement";

const l = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("statementHeadline", () => {
  it("reports the full position when no filter is active", () => {
    expect(statementHeadline({ count: 12 }, false, l)).toBe(
      'headline.all:{"count":"12"}'
    );
  });

  it("reports the filtered count when a filter is active", () => {
    expect(statementHeadline({ count: 3 }, true, l)).toBe(
      'headline.filtered:{"count":"3"}'
    );
  });
});
