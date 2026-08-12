import { describe, expect, it } from "vitest";
import { humanise, permissionTitle } from "./words.js";

describe("humanise", () => {
  it("says a machine key as a sentence", () => {
    expect(humanise("pending_settlement")).toBe("Pending settlement");
    expect(humanise("core.session.login")).toBe("Core session login");
  });

  it("keeps the initialisms a regulator reads", () => {
    expect(humanise("ai.agent.pause")).toBe("AI agent pause");
    expect(humanise("dsar_raised")).toBe("DSAR raised");
    // The audit feed read "Core mfa verified" on the home screen.
    expect(humanise("core.mfa.verified")).toBe("Core MFA verified");
  });
});

// The API-key scope picker labelled its checkboxes with the permission string
// itself — a tenant admin choosing what a key may do was reading
// `core:api_keys:revoke` (docs/ui.md §7.3).
describe("permissionTitle", () => {
  it("says the verb and what it acts on", () => {
    expect(permissionTitle("core:api_keys:revoke")).toBe("Revoke API keys");
    expect(permissionTitle("axis:cases:read")).toBe("Read cases");
  });

  it("falls back to words rather than dropping a malformed grant", () => {
    expect(permissionTitle("axis:*")).toBe("Axis:*");
    expect(permissionTitle("something_odd")).toBe("Something odd");
  });
});
