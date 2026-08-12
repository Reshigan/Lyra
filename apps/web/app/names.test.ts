import { describe, expect, it } from "vitest";
import { who } from "./names";

// The home screen's activity feed and approval strips read
// `ai_budget:signal` and `settlements:cedar-2512` to a tenant admin: /v1/names
// owns the refs that belong to a record, and an engine that numbers its own
// subjects is not one of those.
describe("who", () => {
  it("prefers the resolved name", () => {
    expect(who("usr_01ke953t000wtenzd6wy9tpya0", { usr_01ke953t000wtenzd6wy9tpya0: "Amina Saleh" })).toBe(
      "Amina Saleh"
    );
  });

  it("shortens an opaque id nobody named", () => {
    expect(who("exp_01ke953t000wtenzd6wy9tpya0", {})).toBe("exp_01ke…pya0");
  });

  it("says an engine's own subject as words", () => {
    expect(who("ai_budget:signal", {})).toBe("AI budget signal");
    expect(who("settlements:cedar-2512", {})).toBe("Settlements cedar-2512");
  });

  it("leaves a plain string alone", () => {
    expect(who("Cedar Motor Plus", {})).toBe("Cedar Motor Plus");
    expect(who(null, {})).toBeNull();
  });
});
