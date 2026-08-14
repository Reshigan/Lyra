import { describe, expect, it } from "vitest";
import { labelsIn, onboardingLede, type Step } from "./onboarding";

// The checklist's one-line summary under the title: how much of the required
// ladder is actually cleared, not the static blurb every subject used to share.

function step(over: Partial<Step>): Step {
  return {
    id: "stp_1",
    subjectKind: "partner",
    subjectRef: "ptr_1",
    template: "partner.distribution",
    key: "kyc",
    labelJson: { en: "KYC" },
    seq: 1,
    required: true,
    gatesStage: "screening",
    state: "open",
    evidenceKind: null,
    evidenceRef: null,
    ownerRef: null,
    dueAt: null,
    notesJson: null,
    waivedApprovalId: null,
    decidedBy: null,
    decidedAt: null,
    ...over
  };
}

describe("onboardingLede", () => {
  const l = labelsIn("en");

  it("says there is nothing required when the checklist has no required steps", () => {
    expect(onboardingLede([step({ required: false })], null, l)).toBe(
      "This checklist has no required steps."
    );
  });

  it("counts only required steps, and only done/waived as cleared", () => {
    const steps = [
      step({ state: "done" }),
      step({ state: "waived" }),
      step({ state: "open" }),
      step({ required: false, state: "open" })
    ];
    expect(onboardingLede(steps, null, l)).toBe("2 of 3 required steps cleared.");
  });

  it("names the next stage when one is targeted", () => {
    const steps = [step({ state: "done" }), step({ state: "open" })];
    expect(onboardingLede(steps, "screening", l)).toBe("1 of 2 required steps cleared toward Screening.");
  });

  it("does not clear a failed step", () => {
    expect(onboardingLede([step({ state: "failed" })], null, l)).toBe("0 of 1 required steps cleared.");
  });
});
