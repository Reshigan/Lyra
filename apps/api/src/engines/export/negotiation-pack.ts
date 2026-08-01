// docs/modules/scout.md §2.3/§8 — a negotiation pack: the panel-bench rate
// comparison plus whitespace evidence a negotiator would bring to a provider,
// rendered through the same PDF renderer every other export uses (pdf.ts).
// No new PDF pipeline - this only assembles ReportTables toPdf already knows
// how to draw.

import type { ReportTable } from "@lyra/ledger";
import { checkKAnonymity, DEFAULT_K_FLOOR, type WhitespaceCandidate } from "@lyra/core";

/** The columns of one scout_panel_bench row this pack needs. */
export interface PanelBenchRow {
  readonly providerId: string;
  readonly line: string;
  readonly period: string;
  readonly ourPriceIdx: number | null;
  readonly marketPriceIdx: number | null;
  readonly winRate: number | null;
  readonly volume: number;
}

/**
 * Bench rows below the k-anonymity floor and whitespace candidates flagged
 * not-`visible` are dropped from the pack entirely - the same "hide, don't
 * serve thin" rule apps/api/src/resources.ts applies to panel-bench reads
 * (rowVisible), not masked or aggregated, just left out.
 */
export function buildNegotiationPackTables(
  benchRows: readonly PanelBenchRow[],
  whitespace: readonly WhitespaceCandidate[],
  generatedAt: number,
  kFloor: number = DEFAULT_K_FLOOR
): ReportTable[] {
  const bench: ReportTable = {
    title: "Panel rate comparison",
    columns: [
      { key: "providerId", label: "Provider", kind: "text" },
      { key: "line", label: "Line", kind: "text" },
      { key: "period", label: "Period", kind: "text" },
      { key: "ourPriceIdx", label: "Our price idx", kind: "number" },
      { key: "marketPriceIdx", label: "Market price idx", kind: "number" },
      { key: "winRate", label: "Win rate", kind: "number" }
    ],
    rows: benchRows
      .filter((r) => checkKAnonymity(r.volume, kFloor).allowed)
      .map((r) => ({
        providerId: r.providerId,
        line: r.line,
        period: r.period,
        ourPriceIdx: r.ourPriceIdx,
        marketPriceIdx: r.marketPriceIdx,
        winRate: r.winRate
      })),
    generatedAt
  };

  const gaps: ReportTable = {
    title: "Whitespace evidence",
    columns: [
      { key: "category", label: "Category", kind: "text" },
      { key: "momentum", label: "Momentum", kind: "number" },
      { key: "coverage", label: "Our coverage", kind: "number" }
    ],
    rows: whitespace
      .filter((w) => w.visible)
      .map((w) => ({ category: w.category, momentum: w.momentum, coverage: w.coverage })),
    generatedAt
  };

  return [bench, gaps];
}
