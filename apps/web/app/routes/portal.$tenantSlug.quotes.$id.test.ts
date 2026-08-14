import { describe, expect, it } from "vitest";
import { LABELS, quoteRankingLede } from "./portal.$tenantSlug.quotes.$id";

// J-C1's customer-side comparison. The hero's second line is the ranking
// sentence, real count off the offers the loader fetched, hidden entirely
// once there is nothing to rank.

const l = (key: string) => LABELS.en?.[key] ?? key;

describe("quoteRankingLede", () => {
  it("narrates the real offer count", () => {
    expect(quoteRankingLede(l, 3)).toBe("3 offer(s), ranked by total price, cheapest first.");
  });

  it("says nothing when there is nothing to rank", () => {
    expect(quoteRankingLede(l, 0)).toBeNull();
  });
});

describe("this screen's own labels speak both locales", () => {
  it("has the same keys in en and ar", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("never leaves an Arabic string empty or identical to the English", () => {
    for (const [key, english] of Object.entries(LABELS.en ?? {})) {
      const arabic = LABELS.ar?.[key] ?? "";
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
    }
  });
});
