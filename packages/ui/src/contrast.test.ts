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

/** Dark declares each semantic token first; both light blocks re-map it last
 * (and identically to each other — confirmed in docs/01 review), so "first"/
 * "last" is theme selection. One level of `var(--x)` is resolved against the
 * raw palette, which is declared exactly once. */
function hexOf(token: string, theme: "dark" | "light"): string {
  const values = valuesOf(token);
  const value = theme === "dark" ? values.at(0) : values.at(-1);
  if (!value) throw new Error(`--${token} (${theme}) is not declared in tokens.css`);
  const ref = /^var\(--([a-z0-9-]+)\)/.exec(value)?.[1];
  const raw = ref ? valuesOf(ref).at(0) : value;
  const hex = raw && /#[0-9a-fA-F]{6}/.exec(raw)?.[0];
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

const pairs: [string, string, string][] = [
  ["text-subtle", "on bg", "bg"],
  ["accent-contrast", "on accent", "accent"],
  ["success-contrast", "on success", "success"],
  ["danger-contrast", "on danger", "danger"],
  ["warning-contrast", "on warning", "warning"],
  ["info-contrast", "on info", "info"]
];

describe.each(["dark", "light"] as const)("%s theme semantic pairs clear WCAG AA", (theme) => {
  it.each(pairs)("%s %s", (fg, _label, bg) => {
    expect(contrastRatio(hexOf(fg, theme), hexOf(bg, theme))).toBeGreaterThanOrEqual(AA_BODY);
  });
});
