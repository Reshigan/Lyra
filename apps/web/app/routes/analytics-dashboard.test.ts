import { describe, expect, it } from "vitest";
import { labelsIn } from "./analytics-dashboard";

describe("labelsIn", () => {
  it("reads the local table first", () => {
    expect(labelsIn("en")("total")).toBe("Total");
  });

  // A tile type nobody wrote a label for used to render its own key as the
  // section heading — "claims_by_state" in 12px uppercase tracking, on a board
  // screen (docs/ui.md §7.3).
  it("says a key nobody labelled as words rather than as a key", () => {
    expect(labelsIn("en")("claims_by_state")).toBe("Claims by state");
    expect(labelsIn("en")("ai_spend")).toBe("AI spend");
  });
});
