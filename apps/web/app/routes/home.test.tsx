import { describe, expect, it } from "vitest";
import { isOwnWork } from "./home";

// The activity panel is headed "Your recent activity", which is a promise: it
// lists what this person changed. Signing in is not a change, and the audit log
// records far more of it than of anything else — 179 logins against 2 real
// changes in a seeded tenant.

describe("what counts as your recent activity", () => {
  it("keeps the changes a person made", () => {
    expect(isOwnWork({ action: "compliance.legal-holds.create", subjectRef: "lgh_1" })).toBe(true);
    expect(isOwnWork({ action: "axis.cases.update", subjectRef: "cas_1" })).toBe(true);
  });

  it("leaves session history to Settings › security", () => {
    // Filtering on the action prefix alone missed `core.mfa.verified`, which
    // carries a session id too — so the panel printed `ses_01KE…` at a person
    // who cannot act on it. The subject is the honest test: an event about a
    // session is session history whatever the code is called.
    expect(isOwnWork({ action: "core.session.login", subjectRef: "ses_1" })).toBe(false);
    expect(isOwnWork({ action: "core.session.revoke", subjectRef: "ses_1" })).toBe(false);
    expect(isOwnWork({ action: "core.mfa.verified", subjectRef: "ses_1" })).toBe(false);
  });

  it("keeps an event with no subject at all", () => {
    expect(isOwnWork({ action: "core.settings.update", subjectRef: null })).toBe(true);
  });
});
