/**
 * The AI budget screen printed "0 / 5,000 USD" directly above a line reading
 * "Spent $0.00 / $50.00" — the same ceiling twice, once as minor units wearing
 * the major unit's label. Callers were passing the currency code as `unit`,
 * which is a word next to a number, not a currency for it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetMeter } from "./ai.js";

describe("BudgetMeter", () => {
  it("reads minor units as money when given a currency", () => {
    const markup = renderToStaticMarkup(
      <BudgetMeter label="Cost" used={0} limit={5000} currency="USD" locale="en" />
    );
    expect(markup).toContain("$50.00");
    expect(markup).not.toContain("5,000");
  });

  it("still counts anything that is not money as a plain number", () => {
    const markup = renderToStaticMarkup(
      <BudgetMeter label="Tokens" used={0} limit={5000} unit="tokens" locale="en" />
    );
    expect(markup).toContain("5,000");
    expect(markup).toContain("tokens");
  });
});
