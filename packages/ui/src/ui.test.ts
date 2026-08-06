/**
 * @lyra/ui invariants. No DOM, no jsdom — these assert the three things that
 * silently rot in a design system and that a render test would not catch:
 *
 *   1. tokens.css still defines every token docs/01 §3–4 names (and the same
 *      hex values), so the brand and the code cannot drift apart.
 *   2. No component style uses a physical-direction CSS property or Tailwind
 *      utility, so RTL is structural rather than retro-fitted.
 *   3. No navigation component can render without a visible text label.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shortRef } from "./format.js";
import { fromSelectValue, toSelectValue } from "./primitives.js";
import { KIT_TEXT, uiText } from "./text.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO = join(SRC, "..", "..", "..");

const read = (p: string) => readFileSync(p, "utf8");
const tokens = read(join(SRC, "tokens.css"));
const brandDoc = read(join(REPO, "docs", "01-brand.md"));

const componentFiles = readdirSync(SRC)
  .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts"))
  .map((f) => [f, read(join(SRC, f))] as const);

function section(doc: string, from: string, to: string): string {
  const start = doc.indexOf(from);
  const end = doc.indexOf(to, start + 1);
  expect(start, `docs/01-brand.md must still contain "${from}"`).toBeGreaterThan(-1);
  return doc.slice(start, end === -1 ? undefined : end);
}

/* -------------------------------------------------------------------------- */

describe("tokens.css covers docs/01 §3–4", () => {
  const colour = section(brandDoc, "## 3. Color", "## 4. Typography");
  const typography = section(brandDoc, "## 4. Typography", "## 5. Iconography");

  // Palette table rows: | `ink-900` (Deep Field) | `#070B14` | ... |
  const paletteRows = [...colour.matchAll(/^\|\s*`([a-z]+-\d+)`[^|]*\|\s*`(#[0-9A-Fa-f]{6})`/gm)];

  it("finds the palette table in the brand doc", () => {
    expect(paletteRows.length).toBeGreaterThanOrEqual(11);
  });

  it.each(paletteRows.map((m) => [m[1] as string, m[2] as string]))(
    "defines --%s as %s",
    (token, hex) => {
      const declared = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens);
      expect(declared, `tokens.css must declare --${token}`).not.toBeNull();
      expect(declared?.[1]?.toLowerCase()).toBe(hex.toLowerCase());
    }
  );

  // Module accents: AXIS `#FFB020` (vega) · ORBIT `#37D3B2` (ion) · …
  const moduleAccents = [...colour.matchAll(/\b(AXIS|ORBIT|SIGNAL|SCOUT|NORTH)\s+`(#[0-9A-Fa-f]{6})`/g)];

  it("names all five module accents", () => {
    expect(moduleAccents).toHaveLength(5);
  });

  it.each(moduleAccents.map((m) => [(m[1] as string).toLowerCase(), m[2] as string]))(
    "defines --module-%s as %s",
    (mod, hex) => {
      const declared = new RegExp(`--module-${mod}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens);
      expect(declared, `tokens.css must declare --module-${mod}`).not.toBeNull();
      expect(declared?.[1]?.toLowerCase()).toBe(hex.toLowerCase());
    }
  );

  const fontRoles = ["Space Grotesk", "Inter", "IBM Plex Mono", "IBM Plex Sans Arabic"];
  it.each(fontRoles)("wires the %s type role", (font) => {
    expect(typography, `docs/01 §4 should still name ${font}`).toContain(font);
    expect(tokens, `tokens.css must reference ${font}`).toContain(font);
  });

  // "Scale (rem): 12, 13, 14 (body), 16, 18, 22, 28, 36, 48."
  const scaleLine = /Scale \(rem\):([^.]+)\./.exec(typography)?.[1] ?? "";
  const steps = [...scaleLine.matchAll(/\b(\d{2})\b/g)].map((m) => m[1] as string);

  it("finds the type scale in the brand doc", () => {
    expect(steps.length).toBeGreaterThanOrEqual(9);
  });

  it.each(steps)("defines the --text-%s step", (step) => {
    expect(tokens).toMatch(new RegExp(`--text-${step}:\\s*[\\d.]+rem`));
  });

  it("is dark-first with a light re-map", () => {
    expect(tokens).toContain("color-scheme: dark");
    expect(tokens).toContain('[data-theme="light"]');
    expect(tokens).toContain("prefers-color-scheme: light");
  });

  it("documents the tenant override subset", () => {
    for (const v of ["--accent", "--accent-hover", "--accent-contrast", "--font-display", "--font-ui"]) {
      expect(tokens, `tenant contract must list ${v}`).toContain(v);
    }
    expect(tokens).toContain("TENANT OVERRIDE CONTRACT");
  });

  it("wires Tailwind v4 via @theme", () => {
    expect(tokens).toMatch(/@theme\b/);
    expect(tokens).toContain("--color-accent: var(--accent)");
  });
});

/* -------------------------------------------------------------------------- */

describe("RTL: logical properties only", () => {
  // Physical CSS declarations, and the Tailwind utilities that compile to them.
  const physical: Array<[string, RegExp]> = [
    ["margin-left / margin-right", /\b(?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)\b/],
    ["text-align: left|right", /text-align\s*:\s*(?:left|right)/],
    ["float", /\bfloat\s*:\s*(?:left|right)/],
    ["tw ml-/mr-/pl-/pr-", /(?:^|[\s"'`{-])(?:ml|mr|pl|pr)-/],
    ["tw left-/right-", /(?:^|[\s"'`{-])(?:left|right)-\d/],
    ["tw border-l/border-r", /(?:^|[\s"'`{-])border-[lr](?:\b|-)/],
    ["tw rounded-l/rounded-r/corner", /(?:^|[\s"'`{-])rounded-(?:l|r|tl|tr|bl|br)(?:\b|-)/],
    ["tw text-left/text-right", /(?:^|[\s"'`{-])text-(?:left|right)\b/],
    ["tw float-left/float-right", /(?:^|[\s"'`{-])float-(?:left|right)\b/]
  ];

  it.each(componentFiles)("%s uses no physical-direction styling", (_name, source) => {
    for (const [label, re] of physical) {
      expect(re.test(source), `${_name} must not use ${label}`).toBe(false);
    }
  });

  it("does use the logical equivalents", () => {
    const all = componentFiles.map(([, s]) => s).join("\n");
    for (const logical of ["ms-", "ps-", "pe-", "border-e", "border-s", "text-start", "insetInlineStart"]) {
      expect(all, `expected logical utility ${logical}`).toContain(logical);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("navigation always renders a visible label", () => {
  const nav = read(join(SRC, "nav.tsx"));
  // Comments explain the rule (and so quote the banned words); scan the code.
  const navCode = nav.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const interfaceBody = (name: string): string => {
    const m = new RegExp(`(?:interface|type)\\s+${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(nav);
    expect(m, `nav.tsx must declare ${name}`).not.toBeNull();
    return m?.[1] ?? "";
  };

  // Every component that renders a navigation target.
  it.each(["NavItemProps", "NavSectionProps", "NavRailProps", "ModuleLink"])(
    "%s requires a label",
    (name) => {
      const body = interfaceBody(name);
      expect(body, `${name}.label must be required`).toMatch(/\blabel:\s*string/);
      expect(body, `${name}.label must not be optional`).not.toMatch(/\blabel\?:/);
    }
  );

  it("has no icon-only escape hatch", () => {
    for (const banned of [
      "collapsed",
      "collapsible",
      "iconOnly",
      "icon-only",
      "hideLabel",
      "labelHidden",
      "showLabel",
      "sr-only"
    ]) {
      expect(navCode.includes(banned), `nav.tsx must not contain "${banned}"`).toBe(false);
    }
  });

  it("never renders the label conditionally", () => {
    // A branch on `label` would be the seed of an icon-only mode.
    // `label?:` is a type annotation, not a branch — hence the (?!:).
    expect(navCode).not.toMatch(/\blabel\s*(?:&&|\?(?!:))/);
    // Icons, by contrast, are the optional part.
    expect(navCode).toMatch(/icon\s*\?/);
    expect(navCode).toContain("<span className=\"flex-1 truncate text-start\">{label}</span>");
  });

  it("every optional nav label has a non-empty default", () => {
    const optional = [...nav.matchAll(/\blabel\?:\s*string/g)].length;
    const defaulted = [...nav.matchAll(/\blabel = "[^"]+"/g)].length;
    expect(defaulted).toBeGreaterThanOrEqual(optional);
  });

  it("marks decorative icons aria-hidden", () => {
    expect(nav).toContain('aria-hidden="true"');
  });
});

/* -------------------------------------------------------------------------- */

describe("Select reserves the empty string for Radix", () => {
  // Radix reads `value === ""` on Select.Root as "nothing selected" — it is what
  // raises the placeholder — so a Select.Item may not carry it: Radix says so on
  // the console and the row can never read as chosen. Screens still need an
  // "All" / "System default" row, so the wrapper encodes it. This harness is
  // DOM-free (see the file header), so the contract is asserted where it is
  // decided — the codec and the one call site that feeds Select.Item.
  const primitives = read(join(SRC, "primitives.tsx"));

  it("never hands Select.Item an empty value", () => {
    expect(toSelectValue("")).not.toBe("");
    // Anything Radix would accept passes through untouched.
    for (const value of ["open", "1", "IBM Plex Sans Arabic", "0"]) {
      expect(toSelectValue(value)).toBe(value);
    }
  });

  it("clears the field when the empty row is chosen", () => {
    // What onValueChange reports, and what `name` submits, is "" — not the
    // sentinel — so picking "All" drops the filter instead of inventing one.
    expect(fromSelectValue(toSelectValue(""))).toBe("");
    for (const value of ["open", "1"]) {
      expect(fromSelectValue(toSelectValue(value))).toBe(value);
    }
  });

  it("keeps the sentinel inside the design system", () => {
    // Exported for this test and for nothing else: a call site that could name
    // the sentinel could also mean it, and then it would reach the API.
    const escaped = componentFiles.filter(
      ([name, source]) => name !== "primitives.tsx" && source.includes("SENTINEL")
    );
    expect(escaped.map(([name]) => name)).toEqual([]);
    expect(toSelectValue("")).not.toBe(fromSelectValue(toSelectValue("")));
  });

  it("routes every Select.Item value through the codec", () => {
    const items = [...primitives.matchAll(/<RSelect\.Item[^>]*?\bvalue=\{([^\n]*)\}/g)];
    expect(items.length).toBeGreaterThan(0);
    for (const [, expression] of items) {
      expect(expression, "a Select.Item value must be encoded").toContain("toSelectValue(");
    }
    // …and the value Radix is told is current is the decoded one, so the
    // sentinel never reaches the hidden native input that `name` submits.
    expect(primitives).toContain("fromSelectValue(next)");
  });
});

/* -------------------------------------------------------------------------- */

describe("kit chrome is translated, not hardcoded", () => {
  it("ships an Arabic entry for every English key", () => {
    expect(Object.keys(KIT_TEXT.ar!).sort()).toEqual(Object.keys(KIT_TEXT.en!).sort());
  });

  it("resolves a region subtag to its base locale", () => {
    expect(uiText("ar-AE")("approve")).toBe(KIT_TEXT.ar!.approve);
  });

  it("falls back to English for a locale it has never heard of", () => {
    expect(uiText("pseudo")("approve")).toBe(KIT_TEXT.en!.approve);
  });

  it("fills named slots", () => {
    expect(uiText("en")("requestedBy", { who: "Dana" })).toBe("Requested by Dana");
  });

  // The literals these components used to render inline. A kit that speaks its
  // own English cannot be translated by the app that embeds it, and 98 Table
  // call sites will never all remember to pass a string in.
  const banned = [
    '"Nothing here yet."',
    '"Audit trail"',
    '"Pagination"',
    '"Rows"',
    '"Previous"',
    '"Next"',
    '"Waiting"',
    '"Done"',
    '"When"',
    '"Actor"',
    '"Action"',
    '"Target"',
    '"Detail"',
    '"AI-generated"',
    '"Why this was drafted"',
    '"Model confidence"',
    '"Evidence"',
    '"AI budget"',
    '"Pending approval"',
    "Drafted by",
    "Requested by",
    "Budget exhausted",
    "Resets {",
    ">Reject<",
    ">Approve<",
    "Accept <kbd",
    "Discard <kbd"
  ];

  it.each(["data.tsx", "ai.tsx"])("%s renders no English of its own", (name) => {
    const code = read(join(SRC, name))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s+/g, " ");
    for (const literal of banned) {
      expect(code.includes(literal), `${name} must not contain ${literal}`).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("Table is reachable from the keyboard", () => {
  const data = read(join(SRC, "data.tsx"));

  it("names its scroll region and gives it a tab stop", () => {
    // WCAG 2.2 AA scrollable-region-focusable: a pointer-only scroller strands
    // keyboard users on every wide table in the product.
    expect(data).toMatch(/role="region"[\s\S]{0,240}tabIndex=\{0\}/);
  });

  it("never calls a table row a button", () => {
    // role="button" on a <tr> deletes the row/cell semantics screen readers
    // navigate a table with; the row keeps its tabIndex and Enter handler.
    expect(data).not.toMatch(/role:\s*"button"/);
  });
});

/* -------------------------------------------------------------------------- */

describe("shortRef hides storage keys without hiding anything else", () => {
  it("keeps the prefix and both ends of a ULID", () => {
    expect(shortRef("us_01KE953T07XY8ZQK4M2N6VJH3B")).toBe("us_01KE…JH3B");
  });

  it("keeps a scope in front of the ref", () => {
    expect(shortRef("user:us_01KE953T07XY8ZQK4M2N6VJH3B")).toBe("user:us_01KE…JH3B");
  });

  it.each(["CASE-1042", "sara@example.com", "Sara Haddad", "MOTOR-COMP", ""])(
    "leaves %s alone",
    (value) => {
      expect(shortRef(value)).toBe(value);
    }
  );
});

/* -------------------------------------------------------------------------- */

describe("package surface", () => {
  const index = read(join(SRC, "index.ts"));
  it("re-exports every module", () => {
    for (const [name] of componentFiles) {
      if (name === "index.ts") continue;
      expect(index).toContain(`./${name.replace(/\.tsx?$/, "")}.js`);
    }
  });

  it("exports the names apps/web is written against", () => {
    const all = componentFiles.map(([, s]) => s).join("\n");
    for (const c of ["Button", "Input", "Field", "Card", "Table", "Badge"]) {
      expect(all, `${c} must be exported`).toMatch(new RegExp(`export (?:function|const) ${c}\\b`));
    }
  });
});
