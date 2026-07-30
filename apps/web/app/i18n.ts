import { ar } from "./i18n/ar";
import { en, type MessageKey, type Messages } from "./i18n/en";

// ponytail: plain object catalogues and a replace() interpolator. An ICU
// runtime buys plurals and dates we do not yet render; add one when the first
// pluralised or date-formatted string appears.

export const CATALOGUES: Record<string, Messages> = { en, ar };
export const LOCALES = Object.keys(CATALOGUES);
export const DEFAULT_LOCALE = "en";

/** Locales that lay out right-to-left. Drives `dir` and every logical property. */
const RTL = new Set(["ar", "fa", "he", "ur"]);

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function dirFor(locale: string): "rtl" | "ltr" {
  return RTL.has(baseOf(locale)) ? "rtl" : "ltr";
}

/**
 * Resolve a request to a supported locale: explicit cookie first (the user's
 * saved choice), then Accept-Language, then English.
 */
export function localeFrom(request: Request): string {
  const cookie = readCookie(request.headers.get("cookie"), "lyra_locale");
  if (cookie && CATALOGUES[cookie]) return cookie;

  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const tag = baseOf(part.split(";")[0]?.trim() ?? "");
    if (CATALOGUES[tag]) return tag;
  }
  return DEFAULT_LOCALE;
}

export function translator(locale: string): Translate {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE]!;
  return (key, vars) => {
    // An unknown key renders as itself rather than as an empty box: a missing
    // string should look wrong in review, not invisible in production.
    const template = catalogue[key as MessageKey] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole
    );
  };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function baseOf(tag: string): string {
  return (tag.split("-")[0] ?? "").toLowerCase();
}
