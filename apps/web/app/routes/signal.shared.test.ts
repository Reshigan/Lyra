import { describe, expect, it } from "vitest";
import { mainCurrency, moveEndpoint, totalSpendMinor } from "./signal.shared";
import type { CampaignRow, SpendRow } from "./signal.shared";

// The budget screen's "Moves made" table printed
// `signal_campaign:cmp_0KE95STOARG4GC1CVMRRB6Q4R#meta →
//  signal_campaign:cmp_0KE95STOARG4GC1CVMRRB6Q4R#google_search`
// on every row — the machine's spelling of "Facebook to Google Search".
describe("moveEndpoint", () => {
  const names = { cmp_01KE9: "Renewal save" };

  it("reads as the campaign and the channel inside it", () => {
    expect(moveEndpoint("signal_campaign:cmp_01KE9#meta", names)).toBe("Renewal save · Facebook");
  });

  it("falls back to the channel when the campaign was not loaded", () => {
    expect(moveEndpoint("signal_campaign:cmp_gone#google_search", names)).toBe("Google Search");
  });

  it("names the campaign when the move was not channel-specific", () => {
    expect(moveEndpoint("signal_campaign:cmp_01KE9", names)).toBe("Renewal save");
  });

  it("shows what it was given when it recognises neither", () => {
    expect(moveEndpoint("something_else", names)).toBe("something_else");
  });
});

// The budget screen headed "ZAR 60,000.00" over a table of AED campaigns: the
// first campaign's currency labelling a sum of every campaign's minor units.
const campaign = (currency: string): CampaignRow =>
  ({ budgetJson: { currency, dailyMinor: 50_000 } }) as unknown as CampaignRow;

describe("mainCurrency", () => {
  it("is the one most campaigns are budgeted in", () => {
    expect(mainCurrency([campaign("AED"), campaign("AED"), campaign("ZAR")])).toBe("AED");
  });

  it("falls back when no campaign says", () => {
    expect(mainCurrency([], "AED")).toBe("AED");
  });
});

describe("totalSpendMinor", () => {
  const rows = [
    { amountMinor: 100, currency: "AED" },
    { amountMinor: 250, currency: "ZAR" }
  ] as SpendRow[];

  it("adds only what is in the currency asked for", () => {
    expect(totalSpendMinor(rows, "AED")).toBe(100);
  });

  it("adds everything when no currency is named", () => {
    expect(totalSpendMinor(rows)).toBe(350);
  });
});
