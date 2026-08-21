import type { CalendarPreference } from "@lyra/ui";

// Calendar and currency defaults live outside session.server.ts on purpose:
// `.server.ts` is React Router's server-module boundary, and route components
// (settings.tsx's calendar picker, every screen that formats money) read these
// during client render. Importing them from a `.server` module fails
// `react-router build` with "Server-only module referenced by client".

export const CALENDARS: readonly CalendarPreference[] = ["gregorian", "islamic-umalqura", "dual"];

/**
 * Last resort when neither the row nor the tenant's policy names a currency.
 * One literal, in one place, so a tenant on a different currency is a policy
 * edit rather than a grep. `Intl.NumberFormat` has no neutral code to fall back
 * to — it throws on an empty one — so this cannot simply be absent.
 */
export const FALLBACK_CURRENCY = "AED";

/** Tenant policy is loosely typed across the wire; an unknown value is Gregorian. */
export function calendarFrom(value: unknown): CalendarPreference {
  return CALENDARS.find((known) => known === value) ?? "gregorian";
}

/**
 * The tenant's IANA zone, or `undefined` when it has none. Validated here and
 * not merely trusted: policy is tenant-editable text, and a zone `Intl` does
 * not know throws a `RangeError` from inside `formatToParts` — during render,
 * which drops the whole route to the error boundary. Degrading to `undefined`
 * puts the reader back in their own zone, the same as an unconfigured tenant.
 */
export function timezoneFrom(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

/**
 * The IANA zones this runtime can format dates in, asked of the runtime rather
 * than listed here — a hand-kept list goes stale every time a country renames a
 * zone or splits one. `current` is folded in so a tenant already on a zone this
 * runtime has since dropped can still see, and keep, what it is set to;
 * without that, opening the settings panel and saving would silently clear it.
 */
export function zones(current?: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  if (current && !all.includes(current)) return [current, ...all];
  return [...all];
}
