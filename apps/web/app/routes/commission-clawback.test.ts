import { describe, expect, it } from "vitest";
import { clawbackHeadline } from "./commission-clawback";

const l = (key: string, vars?: Record<string, string>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("clawbackHeadline", () => {
  it("names the policy when the reversal is clear to write", () => {
    expect(clawbackHeadline("POL-001", null, l)).toBe(
      'headline.ready:{"policy":"POL-001"}'
    );
  });

  it("flags the block instead of promising a write that cannot happen", () => {
    expect(clawbackHeadline("POL-001", "blockedClawedBack", l)).toBe(
      'headline.blocked:{"policy":"POL-001"}'
    );
  });
});
