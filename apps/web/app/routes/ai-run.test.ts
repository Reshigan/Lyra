import { describe, expect, it } from "vitest";
import { runLede } from "./ai-run";

// The hero lede must stay silent for states that already get their own
// notice further down the page (stopped/failed/approval) — saying the same
// thing twice is clutter, not clarity.
const L = (key: string, fallback?: string) => fallback ?? key;

describe("runLede", () => {
  it("has something to say for a finished, running, refused or cancelled run", () => {
    expect(runLede("succeeded", L)).toBe("lede.succeeded");
    expect(runLede("running", L)).toBe("lede.running");
    expect(runLede("refused", L)).toBe("lede.refused");
    expect(runLede("cancelled", L)).toBe("lede.cancelled");
  });

  it("stays quiet for states already explained by a notice below", () => {
    expect(runLede("awaiting_approval", L)).toBeNull();
    expect(runLede("budget_stopped", L)).toBeNull();
    expect(runLede("failed", L)).toBeNull();
  });

  it("stays quiet for an unknown state rather than guessing", () => {
    expect(runLede("some_future_state", L)).toBeNull();
  });
});
