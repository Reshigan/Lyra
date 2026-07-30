import { badRequest } from "@lyra/core";
import type { ReportTable } from "@lyra/ledger";
import { majorUnits, minorExponent, rowCurrency } from "./money.js";
import { toXlsx } from "./xlsx.js";
import { pdfSafe, toPdf } from "./pdf.js";

// One table in, one file out. Lifted verbatim out of routes/analytics.ts so the
// ledger's finance reports serialise through the same writer as every analytics
// export — two renderers for the same money is two sets of rounding to explain.

export interface Rendered {
  bytes: Uint8Array;
  contentType: string;
}

export interface RenderOptions {
  totals?: Record<string, number>;
  watermark?: string;
  orientation?: "portrait" | "landscape";
  meta?: Record<string, string>;
}

export type ExportFormat = "xlsx" | "pdf" | "csv" | "json";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["xlsx", "pdf", "csv", "json"];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

export function render(format: ExportFormat, table: ReportTable & { rowCount?: number }, opts: RenderOptions): Rendered {
  switch (format) {
    case "xlsx":
      return {
        bytes: toXlsx([table], opts),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      };
    case "pdf": {
      // Arabic needs an embedded font the base-14 set does not have, so rather
      // than draw question marks the caller is told to ask for XLSX. Typographic
      // punctuation is not this case — pdf.ts folds it to ASCII — so what is
      // left here is genuinely a script the PDF cannot carry.
      if (!pdfSafe([table])) {
        throw badRequest("this report contains non-Latin text the PDF fonts cannot render; export it as xlsx");
      }
      return { bytes: toPdf([table], opts), contentType: "application/pdf" };
    }
    case "csv":
      return { bytes: new TextEncoder().encode(toCsv(table)), contentType: "text/csv; charset=utf-8" };
    default:
      // JSON is the machine-readable format and keeps money in minor units —
      // the same integers the API and the ledger use, with `kind: "money"` on
      // the column to say so. CSV does not, because CSV is opened in a
      // spreadsheet, not parsed. See `toCsv`.
      return {
        bytes: new TextEncoder().encode(JSON.stringify({ ...table, totals: opts.totals }, null, 2)),
        contentType: "application/json"
      };
  }
}

/**
 * Money is written in major units, matching the XLSX and the PDF. CSV looks
 * machine-readable, but this one is not: it opens on a UTF-8 BOM specifically so
 * Excel takes it, which says who actually reads it. The same trial balance
 * arriving as `12000000` in CSV and `120,000.00` in XLSX is how a controller
 * reconciles a figure a hundred times too large, and neither number is labelled.
 * Anything that wants the raw integers asks for JSON, which keeps them.
 *
 * Written as a plain decimal — no separators, no currency symbol — so it still
 * parses as a number. The currency stays in its own column or in the header.
 */
export function toCsv(table: ReportTable): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const value = (c: ReportTable["columns"][number], r: Record<string, unknown>): string => {
    const v = r[c.key];
    if (c.kind !== "money" || v === null || v === undefined || v === "") return esc(v);
    const n = Number(v);
    if (!Number.isFinite(n)) return esc(v);
    const currency = rowCurrency(r, table);
    return majorUnits(n, currency).toFixed(minorExponent(currency));
  };
  const head = table.columns.map((c) => esc(c.label)).join(",");
  const rows = table.rows.map((r) => table.columns.map((c) => value(c, r)).join(","));
  // A leading BOM so Excel opens UTF-8 CSV without mangling Arabic.
  // eslint-disable-next-line no-irregular-whitespace
  return `﻿${[head, ...rows].join("\r\n")}\r\n`;
}
