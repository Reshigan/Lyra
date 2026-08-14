import { describe, expect, it } from "vitest";
import { LABELS, memberLabelsIn, memberLede } from "./staff-member";

// The line under a member's name and status: how many roles they hold, and —
// once onboarding is actually readable — how much of the required checklist
// has cleared. Both numbers come straight off the loader, nothing invented.

describe("memberLede", () => {
  const l = memberLabelsIn("en");

  it("names the role count alone when there is no onboarding checklist to read", () => {
    expect(memberLede(["role_a", "role_b"], [], l)).toBe("2 role(s) held.");
  });

  it("adds onboarding progress once steps are visible, counting only required ones", () => {
    const steps = [
      { required: true, state: "done" },
      { required: true, state: "waived" },
      { required: true, state: "pending" },
      { required: false, state: "pending" }
    ] as never[];
    expect(memberLede(["role_a"], steps, l)).toBe(
      "1 role(s) held. 2 of 3 required onboarding steps cleared."
    );
  });

  it("holds every Arabic key against the same English keys", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });
});
