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

// @accept:M0-rtl (docs/IMPLEMENTATION.md §5): a pseudo-locale catches hardcoded
// strings and layout breaks that en/ar (both real, both fit) never would.
// Deliberately absent from CATALOGUES/LOCALES: it must never appear in the
// settings language picker, only reachable via the same lyra_locale cookie
// mechanism settings.tsx already writes (see e2e/pseudo-locale.spec.ts).
export const PSEUDO_LOCALE = "pseudo";

const ACCENTS: Record<string, string> = {
  a: "á", b: "ß", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í",
  j: "ĵ", k: "ķ", l: "ĺ", m: "ɱ", n: "ñ", o: "ó", p: "ρ", q: "ɋ", r: "ŕ",
  s: "š", t: "ţ", u: "ú", v: "ѵ", w: "ŵ", x: "х", y: "ý", z: "ž"
};

function pseudoize(text: string): string {
  // Split on {placeholders} and leave them untouched — translator()'s
  // interpolation regex requires plain ASCII \w+ inside the braces.
  const mapped = text
    .split(/(\{\w+\})/g)
    .map((part) => (part.startsWith("{") ? part : part.replace(/[a-zA-Z]/g, (c) => ACCENTS[c.toLowerCase()] ?? c)))
    .join("");
  // Pad ~30% longer so truncation/overflow shows up under a real screen, not
  // just in the string table.
  const pad = "‧".repeat(Math.max(3, Math.ceil(mapped.length * 0.3)));
  return `⟦${mapped}${pad}⟧`;
}

const PSEUDO_CATALOGUE: Messages = Object.fromEntries(
  Object.entries(en).map(([key, value]) => [key, pseudoize(value)])
) as Messages;

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function dirFor(locale: string): "rtl" | "ltr" {
  return RTL.has(baseOf(locale)) ? "rtl" : "ltr";
}

/**
 * `<html lang>` must be a valid BCP-47 tag (WCAG 3.1.1 / axe `html-lang-valid`)
 * — "pseudo" alone fails that check. "en-x-pseudo" is valid: a real primary
 * subtag plus the standard "-x-" private-use extension.
 */
export function langFor(locale: string): string {
  return locale === PSEUDO_LOCALE ? "en-x-pseudo" : locale;
}

/**
 * Resolve a request to a supported locale: explicit cookie first (the user's
 * saved choice), then Accept-Language, then English.
 */
export function localeFrom(request: Request): string {
  const cookie = readCookie(request.headers.get("cookie"), "lyra_locale");
  if (cookie === PSEUDO_LOCALE) return PSEUDO_LOCALE;
  if (cookie && CATALOGUES[cookie]) return cookie;

  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const tag = baseOf(part.split(";")[0]?.trim() ?? "");
    if (CATALOGUES[tag]) return tag;
  }
  return DEFAULT_LOCALE;
}

/**
 * `overrides` is a tenant admin's per-key customisation (core_locale_overrides,
 * merged into /v1/me's response) — it wins over the static catalogue so a
 * relabel takes effect without a deploy. Optional and omittable: every
 * existing single-argument call site keeps working unchanged.
 */
export function translator(locale: string, overrides?: Record<string, string>): Translate {
  const catalogue = locale === PSEUDO_LOCALE ? PSEUDO_CATALOGUE : (CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE]!);
  return (key, vars) => {
    // An unknown key renders as itself rather than as an empty box: a missing
    // string should look wrong in review, not invisible in production.
    const template = overrides?.[key] ?? catalogue[key as MessageKey] ?? key;
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
