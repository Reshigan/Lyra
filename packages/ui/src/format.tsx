/**
 * Formatters. ponytail: `Intl` already knows every currency's minor units,
 * every calendar and every locale — no formatting dependency is warranted.
 */
import * as React from "react";
import { cn } from "./cn.js";

/** Minor-unit exponent for a currency (AED/USD → 2, JPY → 0, KWD → 3). */
function minorUnits(currency: string, locale: string): number {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export interface MoneyProps extends Omit<React.ComponentPropsWithRef<"span">, "children"> {
  /** Integer minor units, matching @lyra/ledger's `amountMinor`. */
  amountMinor: number;
  currency: string;
  locale?: string;
  /**
   * Base-currency equivalent. docs/22 §5.1: money never renders as a bare
   * number — when the transaction currency is not the base currency, both are
   * shown together.
   */
  baseMinor?: number;
  baseCurrency?: string;
  /** Force an explicit + on positives (deltas, adjustments). */
  signed?: boolean;
  /** Colour positive/negative with ion/flare. Off for ledger columns. */
  toned?: boolean;
}

export function Money({
  amountMinor,
  currency,
  locale = "en",
  baseMinor,
  baseCurrency,
  signed = false,
  toned = false,
  className,
  ...props
}: MoneyProps) {
  const format = (minor: number, code: string) => {
    const value = minor / 10 ** minorUnits(code, locale);
    const text = new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(value);
    return signed && minor > 0 ? `+${text}` : text;
  };

  const showBase =
    baseMinor !== undefined && baseCurrency !== undefined && baseCurrency !== currency;

  return (
    <span
      {...props}
      className={cn(
        "tabular-nums",
        toned && (amountMinor < 0 ? "text-danger" : amountMinor > 0 ? "text-success" : undefined),
        className
      )}
    >
      {format(amountMinor, currency)}
      {showBase ? (
        <span className="ms-1.5 text-12 text-subtle">
          ({format(baseMinor, baseCurrency)})
        </span>
      ) : null}
    </span>
  );
}

export type DateTimePrecision = "day" | "minute" | "second";

export interface DateTimeProps extends Omit<React.ComponentPropsWithRef<"time">, "dateTime"> {
  value: Date | string | number;
  locale?: string;
  timeZone?: string;
  precision?: DateTimePrecision;
  /** "islamic-umalqura" renders a Hijri date (docs/07 §2 DatePicker note). */
  calendar?: "gregory" | "islamic-umalqura";
  /** Render "3 hours ago" instead of an absolute stamp; title keeps the exact value. */
  relative?: boolean;
}

const precisionOptions: Record<DateTimePrecision, Intl.DateTimeFormatOptions> = {
  day: { year: "numeric", month: "short", day: "2-digit" },
  minute: { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" },
  second: {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }
};

const relativeSteps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY]
];

function relativeText(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  let delta = (date.getTime() - Date.now()) / 1000;
  for (const [unit, size] of relativeSteps) {
    if (Math.abs(delta) < size) return rtf.format(Math.round(delta), unit);
    delta /= size;
  }
  return rtf.format(Math.round(delta), "year");
}

export function DateTime({
  value,
  locale = "en",
  timeZone,
  precision = "minute",
  calendar,
  relative = false,
  className,
  ...props
}: DateTimeProps) {
  const date = value instanceof Date ? value : new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    ...precisionOptions[precision],
    ...(timeZone ? { timeZone } : {}),
    ...(calendar ? { calendar } : {})
  };
  const absolute = new Intl.DateTimeFormat(locale, options).format(date);
  return (
    <time
      {...props}
      dateTime={date.toISOString()}
      title={relative ? absolute : props.title}
      className={cn("tabular-nums", className)}
    >
      {relative ? relativeText(date, locale) : absolute}
    </time>
  );
}
