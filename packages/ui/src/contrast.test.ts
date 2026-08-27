// WCAG AA contrast check for tokens.css's semantic fg/bg pairs (docs/01-brand.md
// §3, ADR-0026). Values are read straight from tokens.css rather than pasted in,
// so a future palette edit that breaks contrast fails this test instead of
// silently shipping. No DOM: relative-luminance math on parsed hex only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(SRC, "tokens.css"), "utf8");

/** Every raw/semantic occurrence of `--token: value;`, in file order. */
function valuesOf(token: string): string[] {
  const re = new RegExp(`--${token}:\\s*([^;]+);`, "g");
  return [...tokens.matchAll(re)].map((m) => (m[1] ?? "").trim());
}

/**
 * Dark declares each token first; both light blocks re-map it last, so
 * "first"/"last" is theme selection. The two light blocks being identical is
 * what makes that safe, and `light blocks agree` below holds it rather than
 * assuming it.
 */
function valueOf(token: string, theme: "dark" | "light"): string {
  const values = valuesOf(token);
  const value = theme === "dark" ? values.at(0) : values.at(-1);
  if (!value) throw new Error(`--${token} (${theme}) is not declared in tokens.css`);
  return value;
}

/**
 * A semantic token as a hex, following `var(--other)` **in the same theme** for
 * as many hops as the token takes. Two things this has to get right. The raw
 * palette is not declared once: `--s1` is `#080b10` in dark and `#ffffff` in
 * light, so resolving a light `--surface-1: var(--s1)` against the first
 * declaration read every card in the app as near-black — which is why only
 * `--bg` was ever safe to use as a background here. And a chain can be longer
 * than one: `--focus` is `var(--accent)` is `var(--vega-500)`.
 */
function hexOf(token: string, theme: "dark" | "light"): string {
  let name = token;
  let value = valueOf(name, theme);
  // The alias `--x: var(--x)` in the `@theme` block would otherwise spin.
  for (let hop = 0; hop < 8; hop++) {
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
    if (!ref || ref === name) break;
    name = ref;
    value = valueOf(name, theme);
  }
  const hex = /#[0-9a-fA-F]{6}/.exec(value)?.[0];
  if (!hex) throw new Error(`--${token} (${theme}) has no resolvable hex: ${value}`);
  return hex;
}

function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const [l1 = 0, l2 = 0] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const AA_BODY = 4.5;
const AA_LARGE = 3; // ≥18px, or bold ≥14px — and the non-text minimum too

/** Every ground body text actually sits on, not only the page ground. */
const GROUNDS = ["bg", "surface-1", "surface-2", "surface-3"] as const;

/** Text tokens the app renders prose in. `--tx5`/`--tx6` are excluded on purpose
 *  — tokens.css marks them decoration only, and `decoration stays off text`
 *  below is what keeps that true. */
const BODY_TEXT = ["text", "text-muted", "text-subtle"] as const;

const onColor: [string, string][] = [
  ["accent-contrast", "accent"],
  ["success-contrast", "success"],
  ["danger-contrast", "danger"],
  ["warning-contrast", "warning"],
  ["info-contrast", "info"]
];

describe.each(["dark", "light"] as const)("%s theme", (theme) => {
  describe("body text clears WCAG AA on every ground it sits on", () => {
    const cases = BODY_TEXT.flatMap((fg) => GROUNDS.map((bg) => [fg, bg] as const));
    it.each(cases)("--%s on --%s", (fg, bg) => {
      expect(contrastRatio(hexOf(fg, theme), hexOf(bg, theme))).toBeGreaterThanOrEqual(AA_BODY);
    });
  });

  it.each(onColor)("--%s clears WCAG AA on --%s", (fg, bg) => {
    expect(contrastRatio(hexOf(fg, theme), hexOf(bg, theme))).toBeGreaterThanOrEqual(AA_BODY);
  });

  // WCAG 2.2 1.4.11 / 2.4.11: the focus indicator is the one non-text token that
  // MUST be visible — a keyboard reader who cannot see it cannot use the app —
  // so it needs 3:1 on every ground a focusable control sits on. The border
  // tokens are deliberately not here: `--border-strong` is an input's *hover*
  // border and `--border-strongest` a chart hairline, both decoration over an
  // affordance that is already carried by the resting border and this ring.
  // ponytail: --track (the meter groove) has no consumer in the tree at all.
  it.each(GROUNDS)("--focus stays visible on --%s", (bg) => {
    expect(contrastRatio(hexOf("focus", theme), hexOf(bg, theme))).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

// tokens.css calls --tx6 "decoration only" and gives its light value a ratio in
// the comment (4.36:1, under AA). The comment is the whole guard today: nothing
// stops a future edit darkening it until it reads as a legitimate body colour,
// at which point someone uses it for text. This fails the moment it clears AA
// body, which is exactly when that comment stops being true. --tx5 is not here:
// its light value is deliberately 5.67:1, so the two are not one rule.
it.each(["dark", "light"] as const)("%s --tx6 stays under AA body", (theme) => {
  expect(contrastRatio(hexOf("tx6", theme), hexOf("bg", theme))).toBeLessThan(AA_BODY);
});

// Theme selection above is positional — dark first, light last — which only holds
// while `@media (prefers-color-scheme: light)` and `[data-theme="light"]` declare
// the same values. They do today; this is what says so when they stop.
it("both light blocks agree, so last-declaration is theme selection", () => {
  const disagree = [...tokens.matchAll(/--([a-z0-9-]+):\s*[^;]+;/g)]
    .map((m) => m[1] as string)
    .filter((token, i, all) => all.indexOf(token) === i)
    .filter((token) => valuesOf(token).length >= 3)
    .filter((token) => {
      // The `@theme` block at the foot aliases some tokens to themselves
      // (`--shadow-glow: var(--shadow-glow)`), which is a Tailwind v4 export and
      // not a theme declaration. Compare the two real ones underneath it.
      const values = valuesOf(token).filter((v) => v !== `var(--${token})`);
      return values.at(-1) !== values.at(-2);
    });
  expect(disagree).toEqual([]);
});
