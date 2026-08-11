import { humanise } from "@lyra/core/words";

import type { Row } from "./api";

// The list and detail screens are deliberately generic: /v1/{module}/{resource}
// returns whatever columns that table has, and mobile has no per-resource
// layouts yet. So a row is reduced to "the field a human would call its name"
// plus "the field they would call its state", and everything else is shown
// verbatim on the detail screen.

/** Ordered by how likely a human is to recognise the row from it. */
const TITLE_FIELDS = ["name", "title", "reference", "subject", "code", "email", "key", "id"];
const SUBTITLE_FIELDS = ["status", "state", "stage", "kind", "type", "email"];

function stringAt(row: Row, field: string): string | undefined {
  const value = row[field];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

export function titleOf(row: Row): string | undefined {
  for (const field of TITLE_FIELDS) {
    const value = stringAt(row, field);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function subtitleOf(row: Row): string | undefined {
  const title = titleOf(row);
  for (const field of SUBTITLE_FIELDS) {
    const value = stringAt(row, field);
    if (value !== undefined && value !== title) {
      // A status arrives as `pending_settlement`; nobody reads it that way.
      return field === "email" ? value : humanise(value);
    }
  }
  return undefined;
}

/** "tenant_id" → "Tenant ID": a raw machine string is never a label. The rule
 *  itself lives in @lyra/core so a status reads the same word on the phone as
 *  it does on the web. */
export const humanize = humanise;

/** Every field of a record, as display pairs. Objects and arrays are shown as
 *  JSON rather than as "[object Object]": raw is honest, blank is not. */
export function fieldsOf(row: Row): { key: string; label: string; value: string }[] {
  return Object.entries(row).map(([key, value]) => ({
    key,
    label: humanize(key),
    value: display(value)
  }));
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
