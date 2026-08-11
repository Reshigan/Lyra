/**
 * Eight screens asked a person to type money in minor units — `50000` for a
 * daily budget, `10000` for a ceiling — with nothing on screen saying so. A
 * user reading "Daily budget" types 500 and buys a hundredth of what they
 * meant. MoneyField takes the amount the way it is spoken and submits the
 * integer the ledger stores.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyField, formatMoney, minorFromMajor } from "./format.js";

describe("minorFromMajor", () => {
  it.each([
    ["500", "ZAR", 50000],
    ["500.5", "ZAR", 50050],
    ["500.55", "ZAR", 50055],
    // Cents beyond the currency's precision are dropped, never rounded up into
    // money the payer did not agree to.
    ["500.559", "ZAR", 50055],
    ["0.01", "ZAR", 1],
    ["-12.34", "ZAR", -1234],
    // 0.1 + 0.2 arithmetic never touches this: the decimal is split, not multiplied.
    ["1234567.89", "ZAR", 123456789],
    ["500", "JPY", 500],
    ["500", "KWD", 500000]
  ])("reads %s %s as %i minor", (text, currency, expected) => {
    expect(minorFromMajor(text, currency, "en")).toBe(expected);
  });

  it.each(["", "   ", "abc", "1,5", "1.2.3"])("refuses %o", (text) => {
    expect(minorFromMajor(text, "ZAR", "en")).toBe(null);
  });
});

describe("MoneyField", () => {
  it("submits minor units while showing the major amount", () => {
    const markup = renderToStaticMarkup(
      <MoneyField name="dailyMinor" currency="ZAR" locale="en" defaultMinor={50000} />
    );
    expect(markup).toContain('value="500"');
    expect(markup).toContain('name="dailyMinor"');
    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('value="50000"');
    // The visible control must not carry the submitted name, or the form sends
    // "500" for a field the API reads as cents.
    expect(markup).not.toContain('name="dailyMinor" type="number"');
  });

  it("names the currency on the control itself", () => {
    const markup = renderToStaticMarkup(<MoneyField name="x" currency="ZAR" locale="en" />);
    expect(markup).toContain("R");
  });
});

describe("formatMoney", () => {
  // The money map divided by a hard-coded 100 and printed no currency at all,
  // which is a wrong number in JPY and an ambiguous one everywhere else.
  it.each([
    [2500000, "AED", "AED\u00a025,000.00"],
    [500, "JPY", "\u00a5500"],
    [500000, "KWD", "KWD\u00a0500.000"]
  ])("renders %i %s with its own precision", (minor, currency, expected) => {
    expect(formatMoney(minor, currency, "en")).toBe(expected);
  });
});
