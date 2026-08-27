import { describe, expect, it } from "vitest";
import { optionLabel } from "./spec";
import { labelsFrom } from "../routes/detail-kit";

// `agentKey` and `purpose` are code constants (`renewal`, `claim_reserve`) that
// six screens print: home, the agent console three times, a run's detail and a
// conversation. They used to reach the reader through `humanise`, which turns
// `claim_reserve` into "Claim reserve" in English and leaves it English for an
// Arabic reader. They now route through `optionLabel`, which resolves
// `common.<owner>.<value>` from the shared catalogue first.
//
// The resolver here is the real one — a stub would prove nothing, because the
// whole fix is that these words live in `common.` once and every screen falls
// through to them.

const l = (locale: string) => labelsFrom({})(locale);

describe("agent keys and AI purposes read as words", () => {
  it("resolves an agent key in both languages", () => {
    expect(optionLabel(l("en"), "agentKey", "renewal")).toBe("Renewal agent");
    expect(optionLabel(l("ar"), "agentKey", "renewal")).toBe("وكيل التجديد");
  });

  it("resolves a purpose in both languages", () => {
    expect(optionLabel(l("en"), "purpose", "claim_reserve")).toBe("Claim reserve");
    expect(optionLabel(l("ar"), "purpose", "claim_reserve")).toBe("احتياطي مطالبة");
  });

  it("humanises a key the catalogue has not caught up with", () => {
    // A ninth agent minted tomorrow still reads as prose, never as an identifier.
    expect(optionLabel(l("en"), "agentKey", "underwriting_triage")).toBe("Underwriting triage");
  });
});
