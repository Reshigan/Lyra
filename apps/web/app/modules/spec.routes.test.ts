import { describe, expect, it } from "vitest";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../routes";
import { WORKSPACES, workspaceFor } from "./index";
import { tabOf } from "./spec";

// Every href a module spec declares — nav links and per-row record links — must
// land somewhere: a bespoke registered route, or the generic module/record
// screens, which only answer for a tab the spec actually has. A spec that
// points at neither ships a 404 into the nav, which is exactly what happened
// to /orbit/console and friends. Real specs on purpose: this test exists to
// break when a module owner adds a link before its screen.

const GENERIC = new Set(["routes/module.tsx", "routes/record.tsx"]);

function flatten(
  entries: readonly RouteConfigEntry[],
  prefix = ""
): Array<{ path: string; file: string }> {
  const out: Array<{ path: string; file: string }> = [];
  for (const entry of entries) {
    const full = entry.path ? [prefix, entry.path].filter(Boolean).join("/") : prefix;
    if (entry.children) out.push(...flatten(entry.children, full));
    else out.push({ path: entry.index ? prefix : full, file: entry.file });
  }
  return out;
}

const bespoke = flatten(routes).filter((r) => !GENERIC.has(r.file));

function matchesPattern(pattern: string, path: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  return p.length === s.length && p.every((seg, i) => seg.startsWith(":") || seg === s[i]);
}

/** Would this href render a screen rather than a 404? */
function resolves(href: string): boolean {
  const path = href.split("?")[0]!.replaceAll(/\{[^}]+\}/g, "x");
  if (bespoke.some((r) => matchesPattern(r.path, path))) return true;
  // The generic fallbacks: /:module lists the first tab, /:module/:resource a
  // named tab, /:module/:resource/:id its record — all 404 unless the tab exists.
  const segments = path.split("/").filter(Boolean);
  const spec = workspaceFor(`/${segments[0]}`);
  if (!spec) return false;
  if (segments.length === 1) return true;
  if (segments.length === 2 || segments.length === 3) return Boolean(tabOf(spec, segments[1]));
  return false;
}

describe("module spec hrefs resolve to real screens", () => {
  for (const spec of WORKSPACES) {
    for (const link of spec.links ?? []) {
      it(`${spec.path} link ${link.href}`, () => {
        expect(resolves(link.href), `${link.href} has no route and no tab`).toBe(true);
      });
    }
    for (const tab of spec.tabs) {
      // Held in a const: the closure below outlives the loop body, so the
      // `continue` guard alone does not narrow it.
      const record = tab.recordLink;
      if (!record) continue;
      it(`${spec.path} tab ${tab.key} recordLink ${record.href}`, () => {
        expect(resolves(record.href), `${record.href} dead`).toBe(true);
      });
    }
  }
});
