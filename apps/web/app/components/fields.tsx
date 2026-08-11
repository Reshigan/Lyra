import {
  Badge,
  Checkbox,
  DateTime,
  Field,
  Input,
  Money,
  Select,
  Textarea,
  type BadgeTone
} from "@lyra/ui";
import type { ColumnSpec, FieldSpec, Row } from "../modules/spec";
import { inputValue, optionLabel } from "../modules/spec";

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
}

export function Cell({ column, row, locale, label }: CellProps) {
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
    case "json":
      return (
        <span className="font-mono text-12 text-subtle">
          {truncate(JSON.stringify(value), 60)}
        </span>
      );
    case "number":
      return <span className="tabular-nums">{String(value)}</span>;
    default: {
      const text = String(value);
      if (column.badge) {
        return (
          <Badge tone={toneFor(text)} size="sm" dot>
            {optionLabel(label, column.name, text)}
          </Badge>
        );
      }
      return <span>{truncate(text, 80)}</span>;
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
          {...(field.type === "money" || field.type === "number" ? { step: 1 } : {})}
        />
      )}
    </Field>
  );
}

function inputTypeFor(field: FieldSpec): string {
  switch (field.type) {
    case "number":
    case "money":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
