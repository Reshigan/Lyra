import { describe, expect, it } from "vitest";
import { firstSentence } from "./north-brief";

describe("firstSentence", () => {
  it("has nothing to headline with when there is no paragraph", () => {
    expect(firstSentence(undefined)).toBeNull();
  });

  it("takes the first sentence off a multi-sentence paragraph", () => {
    expect(firstSentence("Revenue moved up. Costs held flat. Margin improved.")).toBe(
      "Revenue moved up."
    );
  });

  it("keeps the whole paragraph when it has no sentence break", () => {
    expect(firstSentence("Revenue moved up")).toBe("Revenue moved up");
  });

  it("splits on ! and ? as well as .", () => {
    expect(firstSentence("Margin spiked! Nobody expected that.")).toBe("Margin spiked!");
    expect(firstSentence("Is this real? Yes, it is.")).toBe("Is this real?");
  });
});
