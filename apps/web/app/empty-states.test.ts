import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// docs/15 §6 item 9: an empty state teaches one action. A title alone does not
// — "No campaigns" states a fact and abandons the reader, the same abandonment
// as the kit default ("Nothing here yet.", packages/ui/src/text.tsx). EmptyState
// says so in its own docstring (data.tsx): "say what it means, then offer one
// action".
//
// This guards `body=` on EmptyState, not `empty=` on <Table>. The first draft
// guarded the table prop and was measuring the wrong thing twice over: a
// generic parameter (`<Table<Period> …>`) closed the tag scan at its own `>`,
// so tables that DID carry copy read as bare; and most screens guard emptiness
// outside the table (`rows.length === 0 ? <EmptyState … /> : <Table …>`), which
// leaves `empty=` genuinely unreachable and correctly absent. Both shapes
// converge on the same EmptyState, so that is where the contract lives.
//
// Every EmptyState in routes/ now carries a body, so ALLOWED is empty and the
// ratchet has become a wall. It stays a Map rather than a boolean because that
// is what lets a genuinely bodiless state be admitted with a reason in review
// instead of the guard being deleted.
//
// Same shape as spec.json-columns.test.ts — walk the real source, fail on the
// contract violation, keep a list that shrinks.

const ROUTES = join(__dirname, "routes");

/** Title-only empty states, `file:count`. Raise-only downward. */
const ALLOWED = new Map<string, number>();

/**
 * The text of every `<EmptyState …>` opening tag. Depth-tracked rather than a
 * line grep: the tag spans many lines and its props contain `<` and `>` inside
 * both expressions and generic parameters, neither of which ends the tag.
 */
function emptyStateTags(source: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<EmptyState", from);
    if (start === -1) return tags;
    from = start + 11;
    // Not `<EmptyState` if the next character continues an identifier.
    if (/[A-Za-z0-9_]/.test(source[from] ?? "")) continue;

    let braces = 0;
    let angles = 0;
    let index = from;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") braces += 1;
      else if (char === "}") braces -= 1;
      else if (braces > 0) continue;
      else if (char === "<") angles += 1;
      else if (char === ">") {
        if (angles === 0) break;
        angles -= 1;
      }
    }
    tags.push(source.slice(from, index));
    from = index;
  }
}

const files = readdirSync(ROUTES).filter((file) => file.endsWith(".tsx"));
const tagsByFile = files.map((file) => ({
  file,
  tags: emptyStateTags(readFileSync(join(ROUTES, file), "utf8"))
}));
const offenders = tagsByFile
  .map(({ file, tags }) => ({ file, count: tags.filter((tag) => !/\bbody=/.test(tag)).length }))
  .filter((entry) => entry.count > 0);

describe("every empty state says what it means", () => {
  it("finds the empty states it is meant to be guarding", () => {
    // An empty sweep would otherwise pass in perpetuity if EmptyState were
    // renamed or the routes folder moved.
    const total = tagsByFile.reduce((sum, entry) => sum + entry.tags.length, 0);
    expect(total).toBeGreaterThan(150);
  });

  it("adds no new title-only empty state", () => {
    const added = offenders
      .filter((entry) => entry.count > (ALLOWED.get(entry.file) ?? 0))
      .map((entry) => `${entry.file}: ${entry.count} (allowed ${ALLOWED.get(entry.file) ?? 0})`);
    expect(added).toEqual([]);
  });

  it("keeps ALLOWED honest — no entry claiming more than the file has", () => {
    const stale = [...ALLOWED.entries()]
      .map(([file, allowed]) => {
        const actual = offenders.find((entry) => entry.file === file)?.count ?? 0;
        return actual < allowed ? `${file}: allowed ${allowed}, actual ${actual} — lower it` : null;
      })
      .filter(Boolean);
    expect(stale).toEqual([]);
  });
});
