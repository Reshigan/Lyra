import {
  Badge,
  Checkbox,
  DateTime,
  Field,
  formatMoney,
  Input,
  Money,
  Select,
  Textarea,
  type BadgeTone
} from "@lyra/ui";
import type { ColumnSpec, FieldSpec, Row } from "../modules/spec";
import { who, type Names } from "../names";
import { humanise, inputValue, optionLabel, optionWords } from "../modules/spec";

// One place that knows how a typed value renders and how it is edited. Both
// route files (module.tsx, record.tsx) and every bespoke screen share it, so a
// money column looks the same in a case list and on a settlement page.

/** Status words the platform reuses everywhere, mapped to the six tones. */
const TONES: Record<string, BadgeTone> = {
  active: "success",
  approved: "success",
  matched: "success",
  verified: "success",
  settled: "success",
  issued: "success",
  done: "success",
  closed: "neutral",
  posted: "success",
  paid: "success",
  live: "success",
  running: "info",
  reconciling: "info",
  assessing: "info",
  quoting: "info",
  review: "info",
  in_progress: "info",
  extracting: "info",
  intake: "neutral",
  draft: "neutral",
  open: "neutral",
  pending: "warning",
  approval: "warning",
  awaiting_docs: "warning",
  blocked: "warning",
  variance: "warning",
  high: "warning",
  urgent: "danger",
  failed: "danger",
  rejected: "danger",
  cancelled: "danger",
  withdrawn: "danger",
  lapsed: "danger",
  breached: "danger",
  error: "danger"
};

export function toneFor(value: string): BadgeTone {
  return TONES[value] ?? "neutral";
}

export interface CellProps {
  column: ColumnSpec;
  row: Row;
  locale: string;
  /** Resolves a value to its translated label (`status.issued`), if the pack has one. */
  label: (key: string) => string;
  /** Ref → name, from the loader's /v1/names batch. Absent = show the short ref. */
  resolved?: Names;
}

export function Cell({ column, row, locale, label, resolved = {} }: CellProps) {
  const value = row[column.name];
  if (value === null || value === undefined || value === "") {
    return <span className="text-subtle">—</span>;
  }

  switch (column.type) {
    case "money": {
      const currency = column.currencyFrom ? String(row[column.currencyFrom] ?? "") : "";
      // A number with no currency beside it is not money (docs/22 §5.1).
      if (!currency) return <span className="tabular-nums">{String(value)}</span>;
      return <Money amountMinor={Number(value)} currency={currency} locale={locale} />;
    }
    case "date":
    case "datetime":
      return (
        <DateTime
          value={Number(value)}
          locale={locale}
          precision={column.type === "date" ? "day" : "minute"}
        />
      );
    case "boolean":
      return <span>{label(value ? "yes" : "no")}</span>;
    case "json": {
      // The customers list headed a column NAME and printed
      // `{"en":"E2E Visitor"}`, and TAGS `["portal-lead"]`. A JSON column holds
      // a localised name, a list or a small map — all three are readable.
      const text = readable(value, locale);
      if (!text) return <span className="text-subtle">—</span>;
      return <span>{truncate(text, 60)}</span>;
    }
    case "measure": {
      const unit = column.unitFrom ? String(row[column.unitFrom] ?? "") : "";
      const currency = column.currencyFrom ? String(row[column.currencyFrom] ?? "") : "";
      return (
        <span className="tabular-nums">{measure(Number(value), unit, currency, locale)}</span>
      );
    }
    case "number":
      return <span className="tabular-nums">{String(value)}</span>;
    case "rate":
      // Parts per million on the wire, a percentage on screen: 400000 is 40%,
      // and printed bare beside money columns it read as an amount.
      return <span className="tabular-nums">{formatRate(Number(value), locale)}</span>;
    case "ratio":
      return (
        <span className="tabular-nums">
          {new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(Number(value) / 1_000_000)}
        </span>
      );
    default: {
      const text = String(value);
      if (column.badge) {
        return (
          <Badge tone={toneFor(text)} size="sm" dot>
            {optionLabel(label, column.name, text)}
          </Badge>
        );
      }
      // An enum the pack has words for reads as those words: the channels list
      // printed `b2c`, `call_centre` and `us` where the same pack already had
      // "Direct", "Call centre" and "We collect" — badges were the only cells
      // consulting it. No label means the value is not an enum (a key, a
      // number, an email), so it stays exactly as it is.
      const labelled = optionWords(label, column.name, text);
      if (labelled) return <span>{labelled}</span>;
      // A ref-shaped value is an id that escaped into the interface: the cases
      // list printed `user:us_01KE…FMN` under OWNER. `who` names it when the
      // batch resolved it and shortens it when it did not; anything that is not
      // a ref (a name, a case number, an email) comes back untouched.
      return <span>{truncate(who(text, resolved) ?? text, 80)}</span>;
    }
  }
}

/** The input for one spec field, pre-filled from `row` when editing. */
export function FieldInput({
  field,
  row,
  label,
  disabled
}: {
  field: FieldSpec;
  row?: Row;
  label: (key: string) => string;
  disabled?: boolean;
}) {
  const value = inputValue(field, row);
  // Spread conditionally: exactOptionalPropertyTypes rejects an explicit
  // `undefined` where the prop is optional.
  const common = {
    name: field.name,
    ...(field.required ? { required: true } : {}),
    ...(disabled ? { disabled: true } : {})
  };

  if (field.type === "boolean") {
    // Checkbox carries its own label, so it does not sit inside a Field.
    return (
      <Checkbox
        name={field.name}
        label={label(field.name)}
        defaultChecked={Boolean(row?.[field.name])}
        {...(disabled ? { disabled: true } : {})}
      />
    );
  }

  return (
    <Field
      label={label(field.name)}
      required={field.required ?? false}
      {...(field.hintKey ? { hint: label(field.hintKey) } : {})}
    >
      {field.type === "select" ? (
        <Select
          name={field.name}
          {...(value ? { defaultValue: value } : {})}
          options={(field.options ?? []).map((option) => ({
            value: option,
            label: optionLabel(label, field.name, option)
          }))}
          {...(disabled ? { disabled } : {})}
        />
      ) : field.type === "json" || field.type === "textarea" ? (
        <Textarea
          {...common}
          rows={field.type === "json" ? 6 : 3}
          defaultValue={value}
          className={field.type === "json" ? "font-mono text-12" : undefined}
        />
      ) : (
        <Input
          {...common}
          type={inputTypeFor(field)}
          defaultValue={value}
            {...stepFor(field.type)}
        />
      )}
    </Field>
  );
}

/**
 * One `value` column, four meanings. NORTH stores every metric as an integer —
 * minor units for money, basis points for a share, milliseconds for a duration
 * — so the snapshots list printed premium in cents (`74300000`) and a 88.1%
 * response rate (`8810`) in the same column with no unit anywhere on screen.
 */
export function measure(value: number, unit: string, currency: string, locale: string): string {
  if (!Number.isFinite(value)) return "—";
  switch (unit) {
    case "money":
      return currency ? formatMoney(value, currency, locale) : String(value);
    case "percent":
    case "ratio":
      // Basis points (north.ts `thresholdValue.hint`), which is ppm × 100.
      return formatRate(value * 100, locale);
    case "duration_ms":
      return value >= 1000
        ? new Intl.NumberFormat(locale, {
            style: "unit",
            unit: "second",
            maximumFractionDigits: 2
          }).format(value / 1000)
        : new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond" }).format(value);
    default:
      return new Intl.NumberFormat(locale).format(value);
  }
}

/** Numeric inputs need a step or the browser rejects a decimal share. */
function stepFor(type: FieldSpec["type"]): { step?: number } {
  switch (type) {
    case "money":
    case "number":
      return { step: 1 };
    case "rate":
      return { step: 0.01 };
    case "ratio":
      return { step: 0.000001 };
    default:
      return {};
  }
}

/** Parts per million as a percentage, trailing zeroes dropped. */
export function formatRate(ppm: number, locale: string): string {
  if (!Number.isFinite(ppm)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 4
  }).format(ppm / 1_000_000);
}

function inputTypeFor(field: FieldSpec): string {
  switch (field.type) {
    case "number":
    case "money":
    case "rate":
    case "ratio":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}

/**
 * A JSON value as a person reads it: `{en,ar}` in their own locale, a list as
 * a comma-separated list, anything else as its labelled pairs. Empty comes
 * back empty so the caller can render the same em dash a null does.
 */
export function readable(value: unknown, locale: string): string {
  const raw =
    typeof value === "string" && /^\s*[[{]/.test(value) ? safeParse(value) : value;
  if (raw === null || raw === undefined) return "";
  if (Array.isArray(raw)) {
    return raw
      .map((one) => readable(one, locale))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const localised = record[locale] ?? record.en;
    if (typeof localised === "string") return localised.trim();
    return Object.entries(record)
      .map(([key, one]) => {
        // A flag map (`{"pep":true,"sanctions":false}`) reads as the flags that
        // are set, not as a list of the word "true".
        if (typeof one === "boolean") return one ? humanise(key) : "";
        const text = readable(one, locale);
        return text ? `${humanise(key)}: ${text}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return String(raw).trim();
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
