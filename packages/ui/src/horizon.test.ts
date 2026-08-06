/**
 * Horizon grammar invariants. No jsdom in this package, so these assert the two
 * things that fail silently rather than loudly:
 *
 *   1. `hueVar` names a variable tokens.css actually defines.
 *   2. Every colour utility horizon.tsx writes has a matching `--color-*` entry
 *      in `@theme inline`. A typo there renders unstyled instead of throwing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hueVar } from "./horizon.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(SRC, "tokens.css"), "utf8");
const horizon = readFileSync(join(SRC, "horizon.tsx"), "utf8");

const MODULES = ["axis", "orbit", "signal", "scout", "north"] as const;

describe("hueVar", () => {
  it.each(MODULES)("resolves %s to a defined module variable", (module) => {
    expect(hueVar(module)).toBe(`var(--module-${module})`);
    expect(tokens).toContain(`--color-module-${module}:`);
  });

  it("falls back to the neutral accent when a surface belongs to no module", () => {
    expect(hueVar()).toBe("var(--accent)");
    expect(hueVar(null)).toBe("var(--accent)");
  });
});

describe("horizon.tsx only names colours the theme exposes", () => {
  // bg-surface-1, text-ok-tx2, border-accent-line, divide-border, text-subtle…
  const used = new Set(
    [...horizon.matchAll(/\b(?:bg|text|border|divide|fill|stroke)-([a-z0-9]+(?:-[a-z0-9]+)*)/g)].map(
      (m) => m[1] as string
    )
  );

  // Utilities that are not colours at all, or are Tailwind built-ins.
  const NOT_A_COLOUR = new Set([
    "0",
    "12",
    "13",
    "14",
    "16",
    "22",
    "28",
    "36",
    "start",
    "end",
    "relaxed",
    "orbit",
    "md",
    "y",
    "t"
  ]);

  const colours = [...used].filter((u) => !NOT_A_COLOUR.has(u));

  it("finds the colour utilities to check", () => {
    expect(colours.length).toBeGreaterThan(4);
  });

  it.each(colours)("--color-%s is declared in @theme inline", (name) => {
    expect(tokens).toContain(`--color-${name}:`);
  });
});
