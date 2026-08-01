import { and, desc, eq } from "drizzle-orm";
import type { ReportTable } from "@lyra/ledger";
import { schema } from "@lyra/db";
import type { Ctx } from "@lyra/core";

export interface BoardpackSections {
  readonly briefing: ReportTable;
  readonly metrics: ReportTable;
  readonly decisions: ReportTable;
}

/**
 * Pulls the three inputs a board pack needs — the latest exec briefing's
 * highlights, the metric snapshots for the period, and the open decision log
 * — and shapes them into the same ReportTable[] toPdf already knows how to
 * draw. docs/modules/north.md §2.5's "auto-assembled from briefs, metric
 * snapshots, decision log" is exactly this join, no new rendering pipeline.
 */
export async function assembleBoardpackSections(ctx: Ctx, period: string): Promise<BoardpackSections> {
  // Board pack shows the latest exec briefing we have, not one strictly dated
  // within `period` — a briefing date (daily) and a metric period (monthly)
  // are different granularities and don't compare as strings.
  const [briefingRow] = await ctx.db
    .select({ highlightsJson: schema.northBriefings.highlightsJson })
    .from(schema.northBriefings)
    .where(and(eq(schema.northBriefings.tenantId, ctx.tenantId), eq(schema.northBriefings.audience, "exec")))
    .orderBy(desc(schema.northBriefings.date))
    .limit(1);

  const highlights: Array<{ metricKey: string; deltaBps: number; note?: string }> = briefingRow?.highlightsJson
    ? JSON.parse(briefingRow.highlightsJson)
    : [];

  const briefing: ReportTable = {
    title: "Executive briefing highlights",
    columns: [
      { key: "metricKey", label: "Metric", kind: "text" },
      { key: "deltaBps", label: "Delta (bps)", kind: "number" },
      { key: "note", label: "Note", kind: "text" }
    ],
    rows: highlights.map((h) => ({ metricKey: h.metricKey, deltaBps: h.deltaBps, note: h.note ?? "" })),
    generatedAt: ctx.now
  };

  const snapshotRows = await ctx.db
    .select({
      metricKey: schema.northSnapshots.metricKey,
      period: schema.northSnapshots.period,
      value: schema.northSnapshots.value
    })
    .from(schema.northSnapshots)
    .where(and(eq(schema.northSnapshots.tenantId, ctx.tenantId), eq(schema.northSnapshots.period, period)));

  const metrics: ReportTable = {
    title: "Metric snapshot",
    columns: [
      { key: "metricKey", label: "Metric", kind: "text" },
      { key: "period", label: "Period", kind: "text" },
      { key: "value", label: "Value", kind: "number" }
    ],
    rows: snapshotRows,
    generatedAt: ctx.now
  };

  const decisionRows = await ctx.db
    .select({
      title: schema.northDecisions.title,
      owner: schema.northDecisions.owner,
      status: schema.northDecisions.status,
      reviewAt: schema.northDecisions.reviewAt
    })
    .from(schema.northDecisions)
    .where(and(eq(schema.northDecisions.tenantId, ctx.tenantId), eq(schema.northDecisions.status, "open")));

  const decisions: ReportTable = {
    title: "Open decisions",
    columns: [
      { key: "title", label: "Decision", kind: "text" },
      { key: "owner", label: "Owner", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "reviewAt", label: "Review by", kind: "date" }
    ],
    rows: decisionRows,
    generatedAt: ctx.now
  };

  return { briefing, metrics, decisions };
}
