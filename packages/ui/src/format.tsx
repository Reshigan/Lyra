/**
 * Formatters. ponytail: `Intl` already knows every currency's minor units,
 * every calendar and every locale — no formatting dependency is warranted.
 */
import * as React from "react";
import { cn } from "./cn.js";
import { useUiCalendar, useUiLocale, type CalendarPreference } from "./text.js";

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
  locale: explicitLocale,
  baseMinor,
  baseCurrency,
  signed = false,
  toned = false,
  className,
  ...props
}: MoneyProps) {
  // Unset means "whatever the document is in" — a formatter that silently
  // defaults to English is how an Arabic screen ends up with Latin digits.
  const inherited = useUiLocale();
  const locale = explicitLocale ?? inherited;
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

/**
 * A storage key that escaped into the interface: `us_01KE953T07XY8ZQK4M2N6VJH3B`,
 * or `user:us_…` with a scope on the front. Twenty-six base-32 characters are
 * unreadable, unmemorable, and wide enough to burst a card.
 */
const OPAQUE_REF = /^(?:([a-z][a-z0-9]*):)?([a-z][a-z0-9]*_)([0-9a-hjkmnp-tv-z]{16,})$/i;

/**
 * Head and tail of an opaque ref — enough to match one against a log line —
 * and anything that is not one (a case number, an email, a name) untouched, so
 * this is safe to wrap around a field that is only sometimes an id.
 *
 * ponytail: shortening, not resolution. When an endpoint starts returning the
 * display name behind a ref, render the name and demote this to its subtitle.
 */
export function shortRef(value: string): string {
  const match = OPAQUE_REF.exec(value.trim());
  if (!match) return value;
  const [, scope, prefix, body] = match;
  return `${scope ? `${scope}:` : ""}${prefix}${body!.slice(0, 4)}…${body!.slice(-4)}`;
}

export interface RefProps extends Omit<React.ComponentPropsWithRef<"span">, "children"> {
  value: string | null | undefined;
  /** Shown when there is no ref at all. */
  fallback?: string;
}

/** An identifier, shortened when it is opaque, with the whole value on hover. */
export function Ref({ value, fallback = "—", className, title, ...props }: RefProps) {
  const short = value ? shortRef(value) : fallback;
  return (
    <span
      {...props}
      title={title ?? (value && short !== value ? value : undefined)}
      className={cn("font-mono", className)}
    >
      {short}
    </span>
  );
}

export type DateTimePrecision = "day" | "minute" | "second";

export interface DateTimeProps extends Omit<React.ComponentPropsWithRef<"time">, "dateTime"> {
  value: Date | string | number;
  locale?: string;
  timeZone?: string;
  precision?: DateTimePrecision;
  /** Overrides the tenant's own preference (UiCalendarProvider). */
  calendar?: CalendarPreference;
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

/**
 * The absolute stamp, split out so the Hijri rendering is testable without a
 * DOM: `islamic-umalqura` is the Saudi civil calendar, and an ICU upgrade that
 * shifted a date by a day would otherwise be invisible until a customer saw it.
 */
export function formatDate(
  date: Date,
  options: {
    locale: string;
    precision?: DateTimePrecision | undefined;
    calendar?: "islamic-umalqura" | undefined;
    timeZone?: string | undefined;
  }
): string {
  return new Intl.DateTimeFormat(options.locale, {
    ...precisionOptions[options.precision ?? "minute"],
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    ...(options.calendar ? { calendar: options.calendar } : {})
  }).format(date);
}

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
  locale: explicitLocale,
  timeZone,
  precision = "minute",
  calendar: explicitCalendar,
  relative = false,
  className,
  ...props
}: DateTimeProps) {
  const inherited = useUiLocale();
  const inheritedCalendar = useUiCalendar();
  const locale = explicitLocale ?? inherited;
  const preference = explicitCalendar ?? inheritedCalendar;
  const date = value instanceof Date ? value : new Date(value);
  const format = (calendar?: "islamic-umalqura") =>
    formatDate(date, { locale, precision, calendar, timeZone });

  // "dual" reads Gregorian, with the Hijri date one hover away: Gulf contracts
  // cite both, but a table of two calendars per cell is unreadable.
  const absolute = preference === "islamic-umalqura" ? format("islamic-umalqura") : format();
  const hijri = preference === "dual" ? format("islamic-umalqura") : null;
  const title = relative ? absolute : (hijri ?? props.title);

  return (
    <time
      {...props}
      dateTime={date.toISOString()}
      title={relative && hijri ? `${absolute} · ${hijri}` : title}
      className={cn("tabular-nums", className)}
    >
      {relative ? relativeText(date, locale) : absolute}
    </time>
  );
}
