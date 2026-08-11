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

export function pseudoize(text: string): string {
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

/**
 * The last step of a route-local label lookup. Route screens carry their own
 * en/ar tables rather than keys in CATALOGUES, so `translator()` never sees
 * that copy — and under the pseudo-locale those tables fall through to English,
 * which is exactly what a hardcoded JSX literal looks like. The detector can
 * only tell the two apart if translated route copy accents too, so every
 * route-local resolver ends with this call.
 */
export function pseudoText(locale: string, text: string): string {
  return locale === PSEUDO_LOCALE ? pseudoize(text) : text;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function dirFor(locale: string): "rtl" | "ltr" {
  return RTL.has(baseOf(locale)) ? "rtl" : "ltr";
}

/**
 * "from → to" written the way the reader's eye travels. Unicode does not mirror
 * U+2192 for you: an Arabic sentence that reads right-to-left with a rightward
 * arrow in it points back at where the reader started. Direction glyphs are the
 * one place a logical CSS property cannot help — the character itself is wrong.
 */
export function arrowFor(locale: string): "→" | "←" {
  return dirFor(locale) === "rtl" ? "←" : "→";
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
 * The language this person actually chose, or nothing. The cookie is written
 * from their profile at login and again whenever they save it (routes/settings),
 * so it is the one thing both the document (root.tsx: lang/dir) and the shell's
 * strings (routes/workspace) can read — without it they disagree, and an Arabic
 * document renders full of English.
 */
export function chosenLocale(request: Request): string | undefined {
  const cookie = readCookie(request.headers.get("cookie"), "lyra_locale");
  if (cookie === PSEUDO_LOCALE) return PSEUDO_LOCALE;
  return cookie && CATALOGUES[cookie] ? cookie : undefined;
}

/**
 * Resolve a request to a supported locale: explicit choice first, then
 * Accept-Language, then English.
 */
export function localeFrom(request: Request): string {
  const chosen = chosenLocale(request);
  if (chosen) return chosen;

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

/**
 * Module keys as the platform records them against spend, budgets, agents and
 * unit economics — `dist`, `core`, `platform` — against the names the nav puts
 * on the rail. Cost explorer headed a column MODULE and listed "dist", "orbit",
 * "axis" down it; the person reading it navigates by "Distribution" and
 * "Conversations". Keys the nav has no entry for (`core`, `platform`) get their
 * own strings rather than a raw key.
 */
const MODULE_LABEL_KEYS: Record<string, string> = {
  ai: "module.ai",
  dist: "nav.distribution",
  distribution: "nav.distribution",
  core: "module.core",
  platform: "nav.platform"
};

/** A module key as a person reads it. Unknown keys come back title-cased. */
export function moduleName(t: Translate, key: string): string {
  const labelKey = MODULE_LABEL_KEYS[key] ?? `nav.${key}`;
  const label = t(labelKey as MessageKey);
  return label === labelKey ? key.charAt(0).toUpperCase() + key.slice(1) : label;
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
