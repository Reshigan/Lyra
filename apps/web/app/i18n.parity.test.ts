import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Most copy on this platform lives beside the screen that says it, as a pair of
// `en: { … }` / `ar: { … }` tables. A key added to one and forgotten in the
// other is invisible in English and silently untranslated in Arabic — the whole
// screen reads right until an Arabic reader opens it. Catch it here instead.

const APP = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/** The `{ … }` starting at `open`, balanced — nested tables and all. */
function block(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return "";
}

const keysOf = (table: string): string[] =>
  [...table.matchAll(/(?:^|\n)\s+"?([A-Za-z0-9_.-]+)"?:\s/g)].map((match) => match[1]!);

describe("copy tables", () => {
  const files = sources(APP.replace(/\/$/, ""));

  it("finds the pairs it is meant to be guarding", () => {
    const pairs = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /\ben:\s*\{/.test(source) && /\bar:\s*\{/.test(source);
    });
    // A refactor that moves copy somewhere this scan cannot see would otherwise
    // leave the test passing on nothing at all.
    expect(pairs.length).toBeGreaterThan(50);
  });

  it("says the same things in Arabic as in English", () => {
    const gaps: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const en = source.search(/\ben:\s*\{/);
      const ar = source.search(/\bar:\s*\{/);
      if (en < 0 || ar < 0) {
        if (en >= 0 || ar >= 0) gaps.push(`${file}: one locale only`);
        continue;
      }
      const english = keysOf(block(source, source.indexOf("{", en)));
      const arabic = new Set(keysOf(block(source, source.indexOf("{", ar))));
      const missing = english.filter((key) => !arabic.has(key));
      if (missing.length) gaps.push(`${file}: no Arabic for ${missing.join(", ")}`);
    }
    expect(gaps).toEqual([]);
  });
});

// A second way for a screen to lose its reader's language, and the one the
// tables above cannot see: pick the right table with the wrong locale. Root
// resolves the page locale from the request (localeFrom) and puts it on
// <html lang> and dir; nine loaders returned `me.locale` — the signed-in
// profile — instead. Sign-in and the settings picker both write the profile
// into the lyra_locale cookie, so the two agree until someone switches
// language, and then the ORBIT desks and the two AXIS desks rendered English
// copy inside an RTL Arabic page.
describe("the locale a screen speaks", () => {
  const files = sources(APP.replace(/\/$/, ""));

  it("is the one the reader asked for, not the one on their profile", () => {
    const offenders = files.filter((file) => /\blocale:\s*me\.locale\b/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(APP.length))).toEqual([]);
  });

  it("still has loaders to guard", () => {
    // Same reason as above: a scan that matches nothing passes forever.
    const loaders = files.filter((file) => /\blocale:\s*localeFrom\(request\)/.test(readFileSync(file, "utf8")));
    expect(loaders.length).toBeGreaterThan(5);
  });
});
