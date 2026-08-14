import { describe, expect, it } from "vitest";
import { reportStatus } from "./analytics-report";

describe("reportStatus", () => {
  it("prefers a run in flight over everything else", () => {
    expect(reportStatus(true, true, true, "failed")).toBe("running");
  });

  it("shows a just-triggered result once it lands", () => {
    expect(reportStatus(false, true, false, "queued")).toBe("ranNow");
  });

  it("shows the queue when a run is pending but nothing fresh landed yet", () => {
    expect(reportStatus(false, false, true, null)).toBe("inProgress");
  });

  it("flags the last run's failure over stale history", () => {
    expect(reportStatus(false, false, false, "failed")).toBe("lastFailed");
  });

  it("falls back to stale when the last run just succeeded a while ago", () => {
    expect(reportStatus(false, false, false, "succeeded")).toBe("stale");
  });

  it("says never run when there is no history at all", () => {
    expect(reportStatus(false, false, false, null)).toBe("neverRun");
  });
});
