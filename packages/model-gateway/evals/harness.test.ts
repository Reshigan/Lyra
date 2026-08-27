import { describe, expect, it } from "vitest";
import { metric, metricOk } from "./harness.js";

describe("metricOk", () => {
  it("passes a metric that sits exactly on its bound", () => {
    expect(metricOk(metric("m", 0.2, { max: 0.2 }))).toBe(true);
    expect(metricOk(metric("m", 0.95, { min: 0.95 }))).toBe(true);
  });

  // The eval-live failure of 2026-08-27: the CX parity gap is |a/5 - b/5| over
  // integer rubric scores, and a one-point difference is 0.20000000000000018 in
  // IEEE754. The gate failed `parityGapMax: 0.2` by 1.8e-16 while printing the
  // value as `0.200`, blocking a deploy of two unrelated web fixes.
  it("passes a bound missed only by binary representation", () => {
    const gap = Math.abs(23 / 5 - 24 / 5);
    expect(gap).toBeGreaterThan(0.2);
    expect(metricOk(metric("parityGap.ar-en", gap, { max: 0.2 }))).toBe(true);
  });

  it("still fails a metric that misses its bound at the reported precision", () => {
    expect(metricOk(metric("m", 0.2005, { max: 0.2 }))).toBe(false);
    expect(metricOk(metric("m", 0.9494, { min: 0.95 }))).toBe(false);
  });

  it("leaves an unbounded side unbounded", () => {
    expect(metricOk(metric("m", 42, { min: 1 }))).toBe(true);
    expect(metricOk(metric("m", -42, { max: 1 }))).toBe(true);
  });
});
