import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";

// Every screen's label table resolves through detail-kit's `labelsFrom`, so a
// route only needs to write a word down when it means something different from
// what the platform already says. A local entry that restates the shared word
// is drift waiting to happen: the English stays identical while the Arabic
// quietly diverges, which is exactly how "Failed" ended up as فشلت, فشل and
// أخفق on three screens (docs/ui.md §7 P3-14).

const ROUTES = dirname(fileURLToPath(import.meta.url));

/** The `common.*` catalogue, minus the prefix — the fallback `labelsFrom` ends on. */
const COMMON = new Map(
  Object.entries(en)
    .filter(([key]) => key.startsWith("common."))
    .map(([key, value]) => [key.slice("common.".length), value])
);

/** detail-kit's own SHARED table, read as source so the test needs no export. */
const SHARED = new Map(entriesOf(read("detail-kit.tsx"), "export const SHARED"));

describe("route label tables", () => {
  const files = readdirSync(ROUTES).filter((name) => name.endsWith(".tsx") && name !== "detail-kit.tsx");

  it("never restates a word the shared catalogue already says", () => {
    const restated: string[] = [];
    for (const file of files) {
      for (const [key, value] of entriesOf(read(file), "const LABELS")) {
        if (SHARED.get(key) === value || COMMON.get(key) === value) restated.push(`${file}: ${key}`);
      }
    }
    expect(restated).toEqual([]);
  });
});

function read(file: string): string {
  return readFileSync(join(ROUTES, file), "utf8");
}

/**
 * The single-line `key: "value"` entries of the `en` table inside the first
 * declaration whose text starts with `marker`. Multi-line values are skipped —
 * a paragraph is screen-specific copy, not a word to share.
 */
function entriesOf(source: string, marker: string): [string, string][] {
  const declared = source.indexOf(marker);
  if (declared < 0) return [];
  const opens = source.indexOf("en: {", declared);
  if (opens < 0) return [];
  const table = source.slice(opens, closingBrace(source, opens + "en: ".length));
  return [...table.matchAll(/^\s*"?([A-Za-z0-9_.]+)"?:\s*"((?:[^"\\]|\\.)*)",\s*$/gm)].map((match) => [
    match[1]!,
    match[2]!.replace(/\\"/g, '"')
  ]);
}

/** Index of the `}` that closes the `{` at `open`, skipping braces in strings. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '"' || char === "'" || char === "`") {
      index += 1;
      while (index < source.length && source[index] !== char) index += source[index] === "\\" ? 2 : 1;
    } else if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) === 0) return index;
  }
  return source.length;
}
