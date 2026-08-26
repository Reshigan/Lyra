import { describe, expect, it } from "vitest";
import { WORKSPACES } from "./index";

// A `*Json` column holds an object or an array, and `Cell`'s default branch
// renders it with `String(value)` — so a column the API parses into a map and
// the spec declares `text` prints the literal `[object Object]` on screen.
//
// That is what the ORBIT routing desk shipped: teams, team members and routing
// rules each declared `nameJson`/`skillsJson`/`conditionsJson` as `text` in
// `columns` while the matching `fields` entry beside it correctly said `json`.
// The write side was right and the read side was wrong, and nothing compared
// the two because both are valid `FieldType`s.
//
// `type: "json"` routes the value through `readable()` (components/fields.tsx),
// which picks the reader's locale out of a localised name, joins an array and
// flattens a small map. Real specs on purpose: this test exists to break when
// a module owner adds a JSON column as text, the way spec.routes.test.ts
// breaks on a link that has no screen.

const jsonColumns = WORKSPACES.flatMap((workspace) =>
  workspace.tabs.flatMap((tab) =>
    (tab.columns ?? [])
      .filter((column) => column.name.endsWith("Json"))
      .map((column) => ({
        where: `${workspace.path} ${tab.key} ${column.name}`,
        type: column.type
      }))
  )
);

describe("a column holding JSON renders as JSON", () => {
  it("finds the JSON columns it is meant to be guarding", () => {
    // Nothing to assert if the naming convention ever moves; an empty sweep
    // would otherwise pass in perpetuity.
    expect(jsonColumns.length).toBeGreaterThan(0);
  });

  it("declares every `*Json` column `json`, never `text`", () => {
    const wrong = jsonColumns.filter((column) => column.type !== "json");
    expect(wrong.map((column) => `${column.where}: ${column.type}`)).toEqual([]);
  });
});
