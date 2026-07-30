import type { Brand } from "./api";

// Colour is tenant configuration (CLAUDE.md §5, docs/01 §6). These constants are
// the *default* Deep Field skin — the values a tenant that overrides nothing
// gets — mirrored from packages/ui/src/tokens.css. They are not a brand; the
// three tokens a tenant may replace are read from /v1/me tenant.brand.palette.

export interface Theme {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  muted: string;
  subtle: string;
  danger: string;
  accent: string;
  accentHover: string;
  accentContrast: string;
  /** Tenant logo URL, when the brand payload carries one. */
  logo: string | undefined;
  /**
   * Tenant typeface, as a React Native `fontFamily`. `undefined` means the
   * platform typeface — which is also what an unregistered family resolves to,
   * so no value here can break rendering.
   */
  font: string | undefined;
}

const DEEP_FIELD: Omit<Theme, "logo" | "font"> = {
  bg: "#070b14", // ink-900
  surface: "#0c1322", // ink-800
  surfaceRaised: "#131c31", // ink-700
  border: "#1c2842", // ink-600
  text: "#f4f7fc", // star-100 — 16.9:1 on bg
  muted: "#aeb9cf", // star-300 — 8.5:1 on bg
  subtle: "#5e6b87", // star-500 — captions only, never body copy
  danger: "#ff5d5d", // flare-500 — 5.5:1 on bg
  accent: "#ffb020", // vega-500
  accentHover: "#d98e0b", // vega-600
  accentContrast: "#412402" // AA on vega-500
};

/** Type-4 scale from docs/01 §4, in points. */
export const TEXT = { s12: 12, s13: 13, s14: 14, s16: 16, s18: 18, s22: 22, s28: 28 } as const;
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 6, md: 10, lg: 16 } as const;
/** docs/07 §5 and WCAG 2.2 AA target size: nothing tappable is smaller. */
export const TOUCH_TARGET = 44;

/** Only accept a hex colour from the tenant payload — anything else is either a
 *  typo or an attempt to smuggle something into a style, and the default is a
 *  better answer than a crash. */
function hex(value: string | undefined, fallback: string): string {
  return value && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : fallback;
}

/**
 * The typeface half of the tenant override contract — the same three values
 * `BrandJson.font` accepts (packages/db/src/json.ts) and the same set the web
 * shell re-maps `--font-display`/`--font-ui` to
 * (apps/web/app/components/shell.tsx `FONT_STACKS`).
 *
 * A `Map`, not an object literal, for exactly the web's reason: `brand.font` is
 * tenant-controlled text on its way into a style value, and an object literal
 * answers `__proto__` or `constructor` from the prototype chain. A Map answers
 * nothing, and nothing means the platform default.
 *
 * React Native has no font *stacks* — `fontFamily` is one registered family
 * name, with no fallback list and no `system-ui`. So the web's Arabic fallback
 * has no analogue here and needs none: the platform typeface (San Francisco /
 * Roboto) covers Arabic, and it is what an unregistered family resolves to.
 *
 * WHAT ACTUALLY RENDERS: nothing in this repo registers these three families —
 * there are no font assets, and `expo-font` is not a dependency of this package.
 * On a stock build every value here therefore renders as the platform typeface,
 * identical to choosing none. This mapping is the seam (CLAUDE.md §15): a
 * white-label build that ships the `.ttf` and registers it (the `expo-font`
 * config plugin registers a family natively, with no JS import) makes the
 * tenant's saved choice render with no code change. See README "Typeface".
 */
const FONT_FAMILIES = new Map<string, string>([
  ["space-grotesk", "Space Grotesk"],
  ["inter", "Inter"],
  ["ibm-plex-sans-arabic", "IBM Plex Sans Arabic"]
]);

/** The `fontFamily` for a saved brand typeface, or `undefined` for anything off
 *  the approved list. Exported so the mapping is testable without a device. */
export function fontFamilyFor(font: string | undefined): string | undefined {
  return font === undefined ? undefined : FONT_FAMILIES.get(font);
}

export function themeFor(brand: Brand | null | undefined): Theme {
  const palette = brand?.palette;
  return {
    ...DEEP_FIELD,
    accent: hex(palette?.accent, DEEP_FIELD.accent),
    accentHover: hex(palette?.accentHover, DEEP_FIELD.accentHover),
    accentContrast: hex(palette?.accentContrast, DEEP_FIELD.accentContrast),
    // Dark UI, so the dark-background logo is the right one; the mark is the
    // square fallback for a tenant that only uploaded one asset.
    logo: brand?.logo?.dark ?? brand?.logo?.mark ?? brand?.logo?.light,
    font: fontFamilyFor(brand?.font)
  };
}

/** The product name this tenant sees. Falls back to the tenant's own name —
 *  never to a literal, which is exactly what brand tokens exist to prevent. */
export function productName(brand: Brand | null | undefined, tenantName: string): string {
  return brand?.name?.trim() || tenantName;
}
