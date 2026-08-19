import { describe, expect, it } from "vitest";

import { BrandJson, parseJson, PaymentPlanJson, PaymentPlanWrite, toJson } from "./json";

/**
 * Regression: BrandJson.palette declared only { accent, accentHover }, so zod's
 * default strip-unknown-keys behaviour silently dropped accentContrast on every
 * write. The settings screen collects it, hex-validates it and enforces WCAG AA
 * on it before PATCHing; the shell maps it to --accent-contrast; the mobile theme
 * reads it. All three were consuming a field the schema could never persist.
 *
 * --accent-contrast is one of exactly five properties a tenant may override
 * (packages/ui/src/tokens.css), so this is a schema gap, not a client invention.
 */
describe("BrandJson.palette.accentContrast", () => {
  it("survives a write/read round trip", () => {
    const raw = toJson(BrandJson, {
      name: "GONXT",
      palette: { accent: "#5b8cff", accentHover: "#3f6fe0", accentContrast: "#070b14" }
    });

    expect(parseJson(BrandJson, raw).palette).toEqual({
      accent: "#5b8cff",
      accentHover: "#3f6fe0",
      accentContrast: "#070b14"
    });
  });

  it("stays optional, like its two siblings", () => {
    const palette = BrandJson.parse({ name: "GONXT", palette: { accent: "#5b8cff" } }).palette;

    expect(palette).toEqual({ accent: "#5b8cff" });
    expect("accentContrast" in palette).toBe(false);
  });
});

/**
 * The read shape and the write shape of a payment plan are not the same shape,
 * and the split is load-bearing: refusing to read a stored plan declines to
 * lapse a policy that has gone unpaid (fail-open on money), while accepting a
 * plan nobody can render stores the same defect for later.
 */
describe("PaymentPlanJson vs PaymentPlanWrite", () => {
  // A plan seeded outside the API — the lapse sweep's own fixture shape, keys
  // (`frequency`, `grossMinor`) the write shape has never modelled.
  const stored = {
    frequency: "monthly",
    graceDays: 15,
    lapseOnMissed: true,
    instalments: [{ seq: 1, dueAt: -9e15, grossMinor: 8_333, state: "due" }]
  };

  it("reads a stored plan carrying keys and instants the write door refuses", () => {
    const plan = PaymentPlanJson.parse(stored);

    // The sweep only compares `dueAt` to `now`; it never builds a `Date` from
    // it, so an instant outside the `Date` range still identifies a missed
    // instalment rather than turning lapse-on-missed off.
    expect(plan.lapseOnMissed).toBe(true);
    expect(plan.instalments[0]!.dueAt).toBe(-9e15);
  });

  it("refuses that same plan at the write door", () => {
    expect(PaymentPlanWrite.safeParse(stored).success).toBe(false);
  });

  it("refuses a plan-shaped object rather than defaulting lapse-on-missed off", () => {
    expect(PaymentPlanJson.parse({ foo: "bar" }).lapseOnMissed).toBe(false);
    expect(PaymentPlanWrite.safeParse({ foo: "bar" }).success).toBe(false);
  });
});
