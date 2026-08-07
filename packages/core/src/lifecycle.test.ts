import { describe, expect, it } from "vitest";
import {
  CLAIM_STATES,
  CLAIM_TRANSITIONS,
  POLICY_STATES,
  POLICY_TRANSITIONS,
  assertClaimTransition,
  assertPolicyTransition,
  canClaimTransition,
  canPolicyTransition,
  isClaimState,
  isPolicyState
} from "./lifecycle.js";

describe("policy lifecycle", () => {
  it("refuses a hop from cancelled to active", () => {
    expect(canPolicyTransition("cancelled", "active")).toBe(false);
  });

  it("allows lapsed -> active for reinstatement", () => {
    expect(canPolicyTransition("lapsed", "active")).toBe(true);
  });

  it("keeps cancelled, renewed and ntu terminal", () => {
    for (const s of ["cancelled", "renewed", "ntu"] as const) {
      expect(POLICY_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("never lets a policy go on risk without being bound first", () => {
    // draft -> active would skip BIND, which is the only financial hop.
    expect(canPolicyTransition("draft", "active")).toBe(false);
    expect(POLICY_TRANSITIONS.draft).toContain("bound");
    expect(POLICY_TRANSITIONS.bound).toContain("active");
  });

  it("lists only known states as targets", () => {
    for (const from of POLICY_STATES) {
      for (const to of POLICY_TRANSITIONS[from]) {
        expect(POLICY_STATES).toContain(to);
        expect(from).not.toBe(to);
      }
    }
  });

  it("assertPolicyTransition throws conflict on an illegal hop and passes a legal one", () => {
    // conflict() carries the reason in `detail`; the message is the RFC 9457 title.
    expect(() => assertPolicyTransition("expired", "active")).toThrowError(
      expect.objectContaining({ status: 409, detail: "policy cannot move from expired to active" })
    );
    expect(() => assertPolicyTransition("expired", "renewed")).not.toThrow();
  });

  it("isPolicyState rejects a status the machine does not know", () => {
    expect(isPolicyState("active")).toBe(true);
    expect(isPolicyState("issued")).toBe(false);
  });
});

describe("claim lifecycle", () => {
  it("keeps reported as the initial state so seeded rows stay legal", () => {
    expect(POLICY_STATES).not.toContain("reported");
    expect(CLAIM_STATES[0]).toBe("reported");
    expect(canClaimTransition("reported", "triage")).toBe(true);
  });

  it("refuses to pay a claim that was never approved", () => {
    expect(canClaimTransition("assessing", "settling")).toBe(false);
    expect(canClaimTransition("approved", "settling")).toBe(true);
  });

  it("lets a failed payment fall back from settling to approved", () => {
    expect(canClaimTransition("settling", "approved")).toBe(true);
  });

  it("keeps withdrawn terminal and reopened reachable from closed", () => {
    expect(CLAIM_TRANSITIONS.withdrawn).toEqual([]);
    expect(canClaimTransition("closed", "reopened")).toBe(true);
  });

  it("lists only known states as targets", () => {
    for (const from of CLAIM_STATES) {
      for (const to of CLAIM_TRANSITIONS[from]) {
        expect(CLAIM_STATES).toContain(to);
        expect(from).not.toBe(to);
      }
    }
  });

  it("assertClaimTransition throws conflict on an illegal hop", () => {
    expect(() => assertClaimTransition("withdrawn", "assessing")).toThrowError(
      expect.objectContaining({ status: 409, detail: "claim cannot move from withdrawn to assessing" })
    );
  });

  it("isClaimState rejects an unknown status", () => {
    expect(isClaimState("settled")).toBe(true);
    expect(isClaimState("paid")).toBe(false);
  });
});
