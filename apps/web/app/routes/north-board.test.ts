import { describe, expect, it } from "vitest";
import { sectionLine } from "./north-board";

// `sections_json` holds two shapes. The seed writes template sections that name
// what to pull (packages/core/src/seed.ts north_boardpacks); POST
// /v1/north/boardpacks writes resolved ReportTables (packages/ledger/src/reports.ts).
// The board screen renders packs of either vintage, so one helper reads both.

describe("sectionLine", () => {
  it("reads a rendered table by its title and row count", () => {
    expect(sectionLine({ title: "Gross written premium", columns: [], rows: [{}, {}, {}] })).toEqual({
      label: "Gross written premium",
      detail: "rows:3"
    });
  });

  it("counts an empty rendered table as zero rows rather than dropping the section", () => {
    expect(sectionLine({ title: "Decisions", rows: [] })).toEqual({ label: "Decisions", detail: "rows:0" });
    expect(sectionLine({ title: "Decisions" })).toEqual({ label: "Decisions", detail: "rows:0" });
  });

  it("reads a template section's key as its label and counts what it pulls", () => {
    expect(sectionLine({ key: "growth", metricKeys: ["gwp", "policies_in_force"] })).toEqual({
      label: "growth",
      detail: "metrics:2"
    });
    expect(sectionLine({ key: "decisions", decisionRefs: ["dec_1"] })).toEqual({
      label: "decisions",
      detail: "decisions:1"
    });
  });

  it("spaces out a snake_case key so the heading reads as prose", () => {
    expect(sectionLine({ key: "loss_ratio_by_line", metricKeys: [] })?.label).toBe("loss ratio by line");
  });

  it("returns null for anything that is not a section, so the list skips it", () => {
    expect(sectionLine(null)).toBeNull();
    expect(sectionLine("growth")).toBeNull();
    expect(sectionLine({ metricKeys: ["gwp"] })).toBeNull();
  });
});
