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
