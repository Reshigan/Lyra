import { describe, expect, it } from "vitest";
import { runHeadline } from "./compliance-run";

const l = (key: string, vars?: Record<string, string>): string =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

describe("runHeadline", () => {
  it("says nothing before any run", () => {
    expect(runHeadline(undefined, l)).toBeNull();
  });

  it("says nothing when the run failed — the problem card covers it", () => {
    expect(runHeadline({ kind: "screening", problem: { title: "nope", status: 400 } }, l)).toBeNull();
  });

  it("names the screening result", () => {
    expect(
      runHeadline(
        { kind: "screening", problem: null, screening: { result: "hit" } as never },
        l
      )
    ).toBe("headline.screening.hit");
  });

  it("reports a failed bundle", () => {
    expect(
      runHeadline({ kind: "evidence", problem: null, bundle: { state: "failed", manifest: { files: [] } } as never }, l)
    ).toBe("headline.evidenceFailed");
  });

  it("counts the files in a built bundle", () => {
    expect(
      runHeadline(
        { kind: "evidence", problem: null, bundle: { state: "ready", manifest: { files: [1, 2] } } as never },
        l
      )
    ).toBe("headline.evidenceReady:2");
  });

  it("distinguishes a retention preview from an actual purge", () => {
    expect(
      runHeadline({ kind: "retention", problem: null, retention: { dryRun: true, rowsAffected: 5 } as never }, l)
    ).toBe("headline.retentionPlan:5");
    expect(
      runHeadline({ kind: "retention", problem: null, retention: { dryRun: false, rowsAffected: 5 } as never }, l)
    ).toBe("headline.retentionDone:5");
  });
});
