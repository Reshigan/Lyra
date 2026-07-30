/** Join class names. ponytail: 3 lines beats a clsx dependency. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Shared focus treatment. WCAG 2.2 AA: focus is always visible and never
 * removed — docs/07 §5 ("focus rings vega on ink").
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
