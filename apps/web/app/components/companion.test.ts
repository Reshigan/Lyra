import { describe, expect, it } from "vitest";
import { envelopeOf } from "./companion";

// The rail's footer states how far the roster may go on its own, so it reads the
// ladder the way ai-console.tsx does: paused agents are not part of the
// envelope, and a level off the ladder is the most cautious rung, never the
// freest.

const agent = (key: string, autonomyLevel: string, status = "active") => ({
  key,
  module: "axis",
  autonomyLevel,
  status
});

describe("envelopeOf", () => {
  it("reports nothing running when the roster is empty", () => {
    expect(envelopeOf([])).toEqual({ active: 0, paused: 0, ceiling: "suggest" });
  });

  it("takes the ceiling from the freest active agent", () => {
    expect(
      envelopeOf([agent("a", "suggest"), agent("b", "act_within_limits"), agent("c", "act_with_approval")])
    ).toEqual({ active: 3, paused: 0, ceiling: "act_within_limits" });
  });

  it("leaves a paused agent out of the envelope it is held out of", () => {
    expect(envelopeOf([agent("a", "suggest"), agent("b", "autonomous", "paused")])).toEqual({
      active: 1,
      paused: 1,
      ceiling: "suggest"
    });
  });

  it("reads an unrecognised level as the most cautious rung", () => {
    expect(envelopeOf([agent("a", "suggest_only")]).ceiling).toBe("suggest");
  });
});
