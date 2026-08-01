import { describe, expect, it } from "vitest";
import { buildNegotiationPackTables, type PanelBenchRow } from "./negotiation-pack.js";
import { toPdf } from "./pdf.js";
import type { WhitespaceCandidate } from "@lyra/core";

// docs/modules/scout.md §8 — a negotiation pack renders end-to-end to PDF, and
// a cell below the k-anonymity floor is suppressed rather than leaked into it.

const bench = (over: Partial<PanelBenchRow> = {}): PanelBenchRow => ({
  providerId: "prov_gulf",
  line: "motor",
  period: "2026-06",
  ourPriceIdx: 10_400,
  marketPriceIdx: 10_000,
  winRate: 42,
  volume: 50,
  ...over
});

const whitespace = (over: Partial<WhitespaceCandidate> = {}): WhitespaceCandidate => ({
  category: "travel",
  momentum: 88,
  coverage: 2,
  cellCount: 40,
  visible: true,
  ...over
});

const pdfText = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

describe("buildNegotiationPackTables", () => {
  it("assembles bench and whitespace rows into two report tables", () => {
    const [benchTable, gapsTable] = buildNegotiationPackTables([bench()], [whitespace()], 0);
    expect(benchTable!.rows).toEqual([
      { providerId: "prov_gulf", line: "motor", period: "2026-06", ourPriceIdx: 10_400, marketPriceIdx: 10_000, winRate: 42 }
    ]);
    expect(gapsTable!.rows).toEqual([{ category: "travel", momentum: 88, coverage: 2 }]);
  });

  it("drops a bench row below the k-anonymity floor rather than serving it thin", () => {
    const thin = bench({ providerId: "prov_niche", volume: 5 });
    const [benchTable] = buildNegotiationPackTables([bench(), thin], [], 0);
    expect(benchTable!.rows).toHaveLength(1);
    expect(benchTable!.rows.map((r) => r.providerId)).not.toContain("prov_niche");
  });

  it("drops a whitespace candidate the pipeline already flagged not-visible", () => {
    const suppressed = whitespace({ category: "niche", visible: false });
    const [, gapsTable] = buildNegotiationPackTables([], [whitespace(), suppressed], 0);
    expect(gapsTable!.rows.map((r) => r.category)).toEqual(["travel"]);
  });

  it("renders end-to-end to a real PDF with the suppressed cell absent, not leaked", () => {
    const thin = bench({ providerId: "prov_niche", volume: 5 });
    const suppressed = whitespace({ category: "niche_secret", visible: false });
    const tables = buildNegotiationPackTables([bench(), thin], [whitespace(), suppressed], Date.parse("2026-06-15T00:00:00Z"));

    const out = toPdf(tables, { meta: { Tenant: "GONXT" } });
    const text = pdfText(out);

    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("prov_gulf");
    expect(text).toContain("travel");
    expect(text).not.toContain("prov_niche");
    expect(text).not.toContain("niche_secret");
  });
});
