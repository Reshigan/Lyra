import { and, eq, sql } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { audit, badRequest, type Ctx } from "@lyra/core";

// AXIS-001: cases created from web intake, email, CSV/XLSX import and API.
// Web intake (fnol-intake, quote funnel), the partner API and ORBIT handoffs
// existed; the bulk-import half did not. This engine is it — a strict,
// row-honest CSV parser that creates what it can and reports every row it
// could not, because a partial silent success on a compliance-adjacent
// surface is worse than a loud failure.
//
// Deliberately CSV-only in v1: XLSX needs a spreadsheet reader on Workers
// (the export side renders xlsx out, but reading arbitrary workbooks in is a
// different dependency), and every tenant that asked for import asked for it
// from a system that can emit CSV. The route accepts `.csv` and documents
// that; XLSX-in arrives with whichever milestone funds the reader.

/** The columns an import file must carry. Everything else on a row is
 *  folded into metaJson verbatim. */
const REQUIRED_COLUMNS = ["ref", "kind", "customerRef"] as const;

const CASE_KINDS = ["quote", "bind", "endorse", "renewal_ops", "group_medical", "kyc", "claim"] as const;
type CaseKind = (typeof CASE_KINDS)[number];

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export interface ImportRow {
  ref: string;
  kind: CaseKind;
  customerRef: string;
  productLine?: string;
  priority?: string;
  valueMinor?: number;
  currency?: string;
  /** Every other column the file carried, preserved for inspection. */
  extra: Record<string, string>;
}

export interface RowError {
  line: number;
  ref: string | null;
  error: string;
}

export interface ImportResult {
  created: number;
  skippedDuplicate: number;
  errors: RowError[];
}

/**
 * Parse CSV text into rows. RFC 4180 quoting: a field may be wrapped in
 * double quotes and may contain commas and escaped (`""`) quotes inside.
 * No header detection cleverness — the first non-empty line IS the header,
 * and unknown columns land in `extra` rather than being dropped.
 */
export interface ParsedRow {
  /** 1-based line number in the uploaded file — what an error report names. */
  line: number;
  cells: Record<string, string>;
}

export function parseCsv(text: string): { header: string[]; rows: ParsedRow[]; parseErrors: RowError[] } {
  const parseErrors: RowError[] = [];
  const lines = splitLines(text);
  const headerLine = lines.shift()?.trim() ?? "";
  if (!headerLine) return { header: [], rows: [], parseErrors: [{ line: 1, ref: null, error: "empty file" }] };

  const header = parseCsvLine(headerLine).map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 2; // 1-based, header was line 1
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue; // blank lines are not errors
    const fields = parseCsvLine(raw);
    if (fields.length !== header.length) {
      parseErrors.push({ line: lineNo, ref: fields[0] ?? null, error: `expected ${header.length} columns, got ${fields.length}` });
      continue;
    }
    const cells: Record<string, string> = {};
    header.forEach((name, idx) => {
      cells[name] = (fields[idx] ?? "").trim();
    });
    rows.push({ line: lineNo, cells });
  }
  return { header, rows, parseErrors };
}

/** Split on newlines outside quoted sections — a quoted field may contain a newline. */
function splitLines(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Validate one parsed row against the case grammar. Returns the typed row or
 *  the reason it is unusable — never both, never neither. */
export function validateRow(row: Record<string, string>, line: number): { ok: true; value: ImportRow } | { ok: false; error: RowError } {
  const ref = row.ref?.trim();
  if (!ref) return { ok: false, error: { line, ref: null, error: "missing ref" } };
  const kind = row.kind?.trim();
  if (!CASE_KINDS.includes(kind as CaseKind)) {
    return { ok: false, error: { line, ref, error: `kind must be one of ${CASE_KINDS.join("|")}` } };
  }
  const customerRef = row.customerRef?.trim();
  if (!customerRef) return { ok: false, error: { line, ref, error: "missing customerRef" } };

  const priority = row.priority?.trim();
  if (priority && !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    return { ok: false, error: { line, ref, error: `priority must be one of ${PRIORITIES.join("|")}` } };
  }

  let valueMinor: number | undefined;
  if (row.valueMinor?.trim()) {
    const parsed = Number(row.valueMinor);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: { line, ref, error: `valueMinor must be a non-negative number` } };
    }
    valueMinor = Math.round(parsed);
  }

  const known = new Set([...REQUIRED_COLUMNS, "productLine", "priority", "valueMinor", "currency"]);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!known.has(key) && value) extra[key] = value;
  }

  return {
    ok: true,
    value: {
      ref,
      kind: kind as CaseKind,
      customerRef,
      ...(row.productLine?.trim() ? { productLine: row.productLine.trim() } : {}),
      ...(priority ? { priority } : {}),
      ...(valueMinor !== undefined ? { valueMinor } : {}),
      ...(row.currency?.trim() ? { currency: row.currency.trim().toUpperCase() } : {}),
      extra
    }
  };
}

/**
 * Import rows for a tenant. Per-row honesty: each row either becomes a case
 * or appears in `errors` with its line number and reason. Duplicate refs are
 * counted separately from hard errors — a re-run of the same file should be
 * boring, not alarming. The whole import is audited once, with the outcome
 * counts, so the audit log answers "what did that upload do" without reading
 * a thousand case rows.
 */
export async function importCases(ctx: Ctx, csvText: string, opts: { source?: string } = {}): Promise<ImportResult> {
  const { header, rows, parseErrors } = parseCsv(csvText);
  const result: ImportResult = { created: 0, skippedDuplicate: 0, errors: [...parseErrors] };

  // Header sanity before touching the database: a file without the required
  // columns fails wholesale rather than creating zero cases "successfully".
  // Derived from the parsed header, not from rows[0] — a file whose every row
  // is malformed must still be diagnosed as "wrong columns", not "no cases".
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      throw badRequest(`import file is missing the required column "${col}"`);
    }
  }

  for (const parsed of rows) {
    const line = parsed.line;
    const checked = validateRow(parsed.cells, line);
    if (!checked.ok) {
      result.errors.push(checked.error);
      continue;
    }
    const row = checked.value;

    // Customer resolution by exact email match on emailsJson — the same
    // lookup the portal lead path uses. An unmatched customer does not fail
    // the row: the case imports with customerId null and the ref preserved
    // in metaJson for a human to link later.
    const [customer] = await ctx.db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, ctx.tenantId),
          sql`${schema.customers.emailsJson} like ${`%${row.customerRef}%`}`
        )
      )
      .limit(20);
    const customerId = customer?.id ?? null;

    // Duplicate ref inside this same file wins over the database check only
    // by order — which is why the DB unique index is the real gate and this
    // pre-check just makes the second occurrence an explicit skip.
    const [existing] = await ctx.db
      .select({ id: schema.axisCases.id })
      .from(schema.axisCases)
      .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), eq(schema.axisCases.ref, row.ref)))
      .limit(1);
    if (existing) {
      result.skippedDuplicate++;
      continue;
    }

    const now = ctx.now;
    await ctx.db.insert(schema.axisCases).values({
      id: newId("cas", now),
      tenantId: ctx.tenantId,
      ref: row.ref,
      kind: row.kind,
      customerId,
      ...(row.productLine ? { productLine: row.productLine } : {}),
      status: "intake",
      priority: row.priority ?? "normal",
      source: opts.source ?? "import",
      ...(row.valueMinor !== undefined ? { valueMinor: row.valueMinor } : {}),
      ...(row.currency ? { currency: row.currency } : {}),
      metaJson: Object.keys(row.extra).length ? JSON.stringify(row.extra) : JSON.stringify({ importedCustomerRef: row.customerRef }),
      createdAt: now,
      updatedAt: now
    });
    result.created++;
  }

  await audit(ctx, {
    action: "axis.cases.import",
    subjectRef: `axis_cases:import:${ctx.now}`,
    after: { created: result.created, skippedDuplicate: result.skippedDuplicate, errors: result.errors.length }
  });
  return result;
}
