import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@lyra/core/rbac";
import { WORKSPACES } from "./index";
import { labelsFor, type ActionSpec, type WorkspaceSpec } from "./spec";

// A declared action is a verb on a record screen: it posts to an endpoint the
// API owns, so it has to name a permission the platform actually grants, and
// every word it puts in front of a person — its button, its confirm prompt, its
// fields and their hints — has to exist in both locales. An action whose label
// key is missing renders as `policies.ntu`, which is how a state change ends up
// looking like a typo (docs/ui.md §7 item 15).

const held = new Set<string>(PERMISSIONS);

const declared: Array<{ spec: WorkspaceSpec; tab: string; action: ActionSpec }> = WORKSPACES.flatMap(
  (spec) =>
    spec.tabs.flatMap((tab) => (tab.actions ?? []).map((action) => ({ spec, tab: tab.key, action })))
);

/** Every key an action shows a person, in the order they meet them. */
function words(action: ActionSpec): string[] {
  return [
    action.labelKey,
    ...(action.confirm ? [`${action.labelKey}.confirm`] : []),
    ...(action.fields ?? []).flatMap((field) => [field.name, ...(field.hintKey ? [field.hintKey] : [])])
  ];
}

describe("declared record actions", () => {
  it("exist at all — the mechanism is wired, not shelved", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared.map((entry) => [`${entry.spec.path}/${entry.tab}:${entry.action.intent}`, entry] as const))(
    "%s names a real permission and says its words in both locales",
    (_name, { spec, action }) => {
      expect(held.has(action.permission)).toBe(true);
      // `{id}` is what actionUrl substitutes; a path without it would post to
      // the collection and create something instead of changing this record.
      expect(action.path).toContain("{id}");
      for (const locale of ["en", "ar"]) {
        const label = labelsFor(spec, locale);
        // `labelsFor` answers with the key itself when no catalogue holds it.
        for (const key of words(action)) expect([locale, key, label(key)]).not.toEqual([locale, key, key]);
      }
    }
  );
});
