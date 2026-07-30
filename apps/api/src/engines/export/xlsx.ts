import type { ReportTable } from "@lyra/ledger";
import { utf8, zip } from "./zip.js";

// XLSX by hand. Excel is the format finance actually reconciles in, so a CSV
// with a .xlsx name is not good enough: numbers must arrive as numbers, money
// with a currency format, dates as dates. Inline strings avoid a shared-string
// table, which costs a few bytes and saves a whole index.

export interface SheetOptions {
  /** Sheet tab name. Excel forbids : \ / ? * [ ] and caps at 31 chars. */
  name?: string;
  /** Rendered under the title — who ran it, with what filters. */
  meta?: Record<string, string>;
  /** Appended after the data as a bold totals row. */
  totals?: Record<string, number>;
  /** Stamped in the header of every sheet when the export carries PII. */
  watermark?: string;
}

/** Style indices, in the order they are written into styles.xml. */
const S = { normal: 0, title: 1, header: 2, money: 3, date: 4, number: 5, total: 6, totalMoney: 7, meta: 8 } as const;

export function toXlsx(tables: readonly ReportTable[], opts: SheetOptions = {}): Uint8Array {
  const sheets = tables.map((t, i) => sheetXml(t, opts, i));
  const names = tables.map((t, i) => sheetName(opts.name && tables.length === 1 ? opts.name : t.title, i));

  return zip([
    { path: "[Content_Types].xml", data: utf8(contentTypes(sheets.length)) },
    { path: "_rels/.rels", data: utf8(ROOT_RELS) },
    { path: "xl/workbook.xml", data: utf8(workbook(names)) },
    { path: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels(sheets.length)) },
    { path: "xl/styles.xml", data: utf8(styles(tables[0]?.currency ?? "AED")) },
    ...sheets.map((xml, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(xml) }))
  ]);
}

/* ----------------------------------------------------------------- sheet */

function sheetXml(t: ReportTable, opts: SheetOptions, index: number): string {
  const rows: string[] = [];
  let r = 1;

  rows.push(row(r++, [cell("A", r - 1, t.title, S.title)]));
  if (opts.watermark) rows.push(row(r++, [cell("A", r - 1, opts.watermark, S.meta)]));
  rows.push(row(r++, [cell("A", r - 1, `Generated ${iso(t.generatedAt)}`, S.meta)]));
  for (const [k, v] of Object.entries(opts.meta ?? {})) {
    rows.push(row(r++, [cell("A", r - 1, `${k}: ${v}`, S.meta)]));
  }
  rows.push(row(r++, []));

  const headerRow = r;
  rows.push(row(r++, t.columns.map((c, i) => cell(col(i), headerRow, c.label, S.header))));

  for (const data of t.rows) {
    const at = r++;
    rows.push(
      row(
        at,
        t.columns.map((c, i) => {
          const v = data[c.key];
          if (v === null || v === undefined) return cell(col(i), at, "", S.normal);
          if (c.kind === "money") return num(col(i), at, Number(v) / 100, S.money);
          if (c.kind === "number") return num(col(i), at, Number(v), S.number);
          if (c.kind === "date") return cell(col(i), at, iso(Number(v)), S.date);
          return cell(col(i), at, String(v), S.normal);
        })
      )
    );
  }

  if (opts.totals && Object.keys(opts.totals).length) {
    const at = r++;
    rows.push(
      row(
        at,
        t.columns.map((c, i) => {
          const v = opts.totals?.[c.key];
          if (i === 0) return cell(col(i), at, "Total", S.total);
          if (v === undefined) return cell(col(i), at, "", S.total);
          return num(col(i), at, c.kind === "money" ? v / 100 : v, c.kind === "money" ? S.totalMoney : S.total);
        })
      )
    );
  }

  const widths = t.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(c, t.rows)}" customWidth="1"/>`)
    .join("");

  // The header row freezes, and the data range gets an autofilter — because the
  // first thing anyone does with an export is sort it.
  const last = `${col(Math.max(t.columns.length - 1, 0))}${r - 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView ${index === 0 ? 'tabSelected="1" ' : ""}workbookViewId="0">` +
    `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<cols>${widths}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    (t.columns.length ? `<autoFilter ref="A${headerRow}:${last}"/>` : "") +
    `</worksheet>`
  );
}

function row(n: number, cells: string[]): string {
  return `<row r="${n}">${cells.join("")}</row>`;
}

function cell(c: string, r: number, value: string, style: number): string {
  if (value === "") return `<c r="${c}${r}" s="${style}"/>`;
  return `<c r="${c}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function num(c: string, r: number, value: number, style: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `<c r="${c}${r}" s="${style}"><v>${safe}</v></c>`;
}

function col(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function width(c: ReportTable["columns"][number], rows: readonly Record<string, unknown>[]): number {
  const longest = rows.slice(0, 200).reduce((m, r) => Math.max(m, String(r[c.key] ?? "").length), c.label.length);
  return Math.min(Math.max(longest + 2, 10), 48);
}

/* -------------------------------------------------------------- packaging */

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

function contentTypes(sheets: number): string {
  const parts = Array.from(
    { length: sheets },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    parts +
    `</Types>`
  );
}

function workbook(names: readonly string[]): string {
  const sheets = names
    .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRels(sheets: number): string {
  const rels = Array.from(
    { length: sheets },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    `<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

function styles(currency: string): string {
  // numFmtId 164 is the first id available to a document; anything below 164 is
  // reserved by the spec.
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2">` +
    `<numFmt numFmtId="164" formatCode="&quot;${esc(currency)} &quot;#,##0.00"/>` +
    `<numFmt numFmtId="165" formatCode="#,##0"/>` +
    `</numFmts>` +
    `<fonts count="4">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="16"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1E1B4B"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2"><border/><border><top style="thin"><color rgb="FF9CA3AF"/></top></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="9">` +
    `<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>` + // 0 normal
    `<xf xfId="0" numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>` + // 1 title
    `<xf xfId="0" numFmtId="0" fontId="2" fillId="2" borderId="0" applyFont="1" applyFill="1"/>` + // 2 header
    `<xf xfId="0" numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>` + // 3 money
    `<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>` + // 4 date (ISO text)
    `<xf xfId="0" numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>` + // 5 number
    `<xf xfId="0" numFmtId="165" fontId="2" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` + // 6 total
    `<xf xfId="0" numFmtId="164" fontId="2" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>` + // 7 total money
    `<xf xfId="0" numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>` + // 8 meta
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sheetName(raw: string, i: number): string {
  const cleaned = raw.replace(/[:\\/?*[\]]/g, " ").slice(0, 31).trim();
  return cleaned || `Sheet${i + 1}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Excel rejects control characters outright rather than ignoring them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
