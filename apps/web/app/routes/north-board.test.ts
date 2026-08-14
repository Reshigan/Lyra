import { describe, expect, it } from "vitest";
import { headline, sectionLine } from "./north-board";

const l = (key: string, vars?: Record<string, string>) => {
  const table: Record<string, string> = {
    title: "Board packs",
    "headline.draft": "The {period} pack has not been assembled yet.",
    "headline.review": "The {period} pack is assembled and waiting on distribution.",
    "headline.final": "The {period} pack is finalised.",
    "headline.distributed": "The {period} pack has gone out to the board."
  };
  const raw = table[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : raw;
};

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

describe("headline", () => {
  it("falls back to the title when no pack is open", () => {
    expect(headline(null, l)).toBe("Board packs");
  });

  it("narrates a pack still waiting on distribution", () => {
    expect(headline({ period: "2026-Q3", status: "review" }, l)).toBe(
      "The 2026-Q3 pack is assembled and waiting on distribution."
    );
  });

  it("narrates a pack that has not been assembled yet", () => {
    expect(headline({ period: "2026-Q1", status: "draft" }, l)).toBe(
      "The 2026-Q1 pack has not been assembled yet."
    );
  });

  it("narrates a finalised pack", () => {
    expect(headline({ period: "2026-Q2", status: "final" }, l)).toBe("The 2026-Q2 pack is finalised.");
  });

  it("narrates a distributed pack without a count — a count needs a plural rule per locale", () => {
    expect(headline({ period: "2025-Q4", status: "distributed" }, l)).toBe(
      "The 2025-Q4 pack has gone out to the board."
    );
  });
});
