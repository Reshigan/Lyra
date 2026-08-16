import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ar } from "./i18n/ar";
import { en } from "./i18n/en";
import { HIDDEN_ROUTES, WORKSPACE_PATHS, availableShellsForRoles, labelKeyFor, landingFor } from "./routing";

// The three invariants of the shell that can be checked without a DOM: every
// route is labelled, every locale is complete, and no component smuggles in an
// English literal. Rendering is covered by the journey specs (docs/13).

const APP_DIR = dirname(fileURLToPath(import.meta.url));

describe("route tree", () => {
  const declared = declaredRoutes();

  it("routes every workspace path declared in routing.ts", () => {
    for (const path of WORKSPACE_PATHS) expect(declared).toContain(path);
  });

  it("gives every route a nav label or a documented reason to be hidden", () => {
    for (const path of declared) {
      if (path in HIDDEN_ROUTES) {
        expect(HIDDEN_ROUTES[path]!.length).toBeGreaterThan(10);
        continue;
      }
      // Unhidden means it appears in the sidebar, and the sidebar renders
      // t(labelKey) — so a missing key would render as a raw key.
      expect(Object.keys(en)).toContain(labelKeyFor(path));
    }
  });

  it("lands each role on a workspace their nav actually offers", () => {
    const nav = [{ href: "/" }, { href: "/axis" }, { href: "/north" }, { href: "/admin" }, { href: "/platform" }];
    expect(landingFor(["north.exec"], nav)).toBe("/north");
    // Platform staff are not tenant admins; their own workspace is the landing.
    expect(landingFor(["platform.support"], nav)).toBe("/platform");
    expect(landingFor(["axis.agent"], nav)).toBe("/axis");
    expect(landingFor(["tenant.admin"], nav)).toBe("/admin");
    // A role with no workspace of its own never lands on "/" (that would loop)
    // and never lands somewhere the API did not offer.
    expect(landingFor(["orbit.agent"], nav)).toBe("/axis");
    expect(landingFor([], [{ href: "/" }])).toBe("/settings");
  });
});

describe("availableShellsForRoles", () => {
  it("returns every distinct workspace a multi-role actor's roles resolve to", () => {
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toEqual(
      expect.arrayContaining(["north", "axis"])
    );
    expect(availableShellsForRoles(["north.exec", "axis.agent"])).toHaveLength(2);
  });

  it("returns exactly one shell for a single-role actor", () => {
    expect(availableShellsForRoles(["north.exec"])).toEqual(["north"]);
  });

  it("falls back to north when no role resolves to anything", () => {
    expect(availableShellsForRoles([])).toEqual(["north"]);
  });
});

describe("message catalogues", () => {
  it("keeps en and ar on exactly the same keys", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty or untranslated ar strings", () => {
    for (const [key, value] of Object.entries(ar)) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toBe(en[key as keyof typeof en]);
    }
  });
});

describe("no hard-coded user-facing English", () => {
  // ponytail: a heuristic, not a parser. It flags prose in JSX text nodes and in
  // the attributes that reach a user, which is every way a literal has actually
  // shipped. Swap for an eslint rule if it ever needs to be exact.
  const TEXT_ATTRIBUTES = /\b(aria-label|aria-description|placeholder|title|alt|label)\s*=\s*"([^"]*[A-Za-z]{2}[^"]*)"/g;
  // The `>` of an arrow function is not the end of a JSX tag: `() => Promise<T>`
  // would otherwise read as the literal "Promise".
  const JSX_TEXT = /(?<![=-])>([^<>{}]+)</g;

  for (const file of sources(APP_DIR)) {
    it(`keeps ${file.replace(`${APP_DIR}/`, "")} translated`, () => {
      const source = stripComments(readFileSync(file, "utf8"));

      expect(matches(source, TEXT_ATTRIBUTES, 2), "literal text attribute").toEqual([]);
      expect(
        matches(source, JSX_TEXT, 1).filter(isProse),
        "literal text in JSX"
      ).toEqual([]);
    });
  }
});

/* ------------------------------------------------------------------ helpers */

/** Paths declared in routes.ts, expanded with the workspace list it spreads in. */
function declaredRoutes(): string[] {
  const source = readFileSync(join(APP_DIR, "routes.ts"), "utf8");
  const literal = [...source.matchAll(/\broute\(\s*"([^"]+)"/g)].map((m) => `/${m[1]}`);
  const hasIndex = /\bindex\(/.test(source);
  // Workspaces are served by the generic `:module` route rather than one entry
  // each, so that dynamic segment is what covers WORKSPACE_PATHS.
  const spreadsWorkspaces = /WORKSPACE_PATHS\.map/.test(source) || /route\(\s*":module"/.test(source);
  return [
    ...(hasIndex ? ["/"] : []),
    ...literal,
    ...(spreadsWorkspaces ? [...WORKSPACE_PATHS] : [])
  ];
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function matches(source: string, pattern: RegExp, group: number): string[] {
  return [...source.matchAll(pattern)].map((m) => (m[group] ?? "").trim()).filter(Boolean);
}

/**
 * Prose = words a person reads. Anything carrying operators, quotes, calls or
 * property access is code the JSX-text regex swept up on its way past.
 */
function isProse(text: string): boolean {
  if (/[=;(){}[\]"'`|&$]/.test(text)) return false;
  if (/\w\.\w/.test(text)) return false;
  return /[A-Za-z]{2,}(\s+[A-Za-z]{2,})+/.test(text) || /^[A-Za-z]{3,}$/.test(text);
}
