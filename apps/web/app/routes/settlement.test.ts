import { describe, expect, it } from "vitest";
import { queueHeadline, type QueueGroup } from "./settlement";

const l = (key: string, vars?: Record<string, string>): string =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

const group = (state: string, currency: string, count: number): QueueGroup => ({
  state,
  currency,
  count,
  netMinor: 0,
});

describe("queueHeadline", () => {
  it("falls back to the static intro when the queue is empty", () => {
    expect(queueHeadline([], l)).toBe("intro");
  });

  it("counts a queue with nothing awaiting a second signature", () => {
    expect(queueHeadline([group("drafted", "ZAR", 3)], l)).toBe("queueHeadline.count:3");
  });

  it("calls out settlements awaiting a second signature", () => {
    expect(queueHeadline([group("drafted", "ZAR", 2), group("approved", "ZAR", 1)], l)).toBe(
      "queueHeadline.awaiting:3,1"
    );
  });

  it("sums counts across currencies", () => {
    expect(
      queueHeadline([group("approved", "ZAR", 2), group("approved", "AED", 1)], l)
    ).toBe("queueHeadline.awaiting:3,3");
  });
});
