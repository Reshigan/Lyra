import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A `<Table>` with no `empty=` falls back to the kit default — the bare
// sentence "Nothing here yet." (packages/ui/src/text.tsx). No title, no cause,
// no next step: the screen states a fact and abandons the reader, which is
// exactly what docs/15 §6 item 9 forbids ("empty state teaches one action").
//
// The audit that produced this guard found 58 of 135 tables in that state. It
// is a ratchet, not a wall: ALLOWED holds the tables that have not been given
// copy yet, and the count may only fall. Delete a line when you write its
// `empty=`; adding one needs a reason in review.
//
// The same shape as spec.json-columns.test.ts — walk the real source, fail on
// the contract violation, keep a list that shrinks.

const ROUTES = join(__dirname, "routes");

/** Tables still on the kit default, `file:count`. Raise-only downward. */
const ALLOWED = new Map<string, number>([
  ["signal-cockpit.tsx", 4],
  ["ledger-periods.tsx", 3],
  ["ledger-recon.tsx", 3],
  ["ledger-transaction.tsx", 3],
  ["settings.tsx", 3],
  ["orbit-console.tsx", 2],
  ["orbit-quality.tsx", 2],
  ["orbit-save.tsx", 2],
  ["orbit-supervisor.tsx", 2],
  ["scout-pricing.tsx", 2],
  ["signal-analytics.tsx", 2],
  ["signal-budget.tsx", 2],
  ["signal-experiments.tsx", 2],
  ["staff.tsx", 2],
  ["admin-roles.tsx", 1],
  ["commission-statement.tsx", 1],
  ["ledger-account.tsx", 1],
  ["ledger-open-txn.tsx", 1],
  ["ledger-year-end.tsx", 1],
  ["north-alerts.tsx", 1],
  ["north-board.tsx", 1],
  ["north-decisions.tsx", 1],
  ["north-explorer.tsx", 1],
  ["north-whatif.tsx", 1],
  ["orbit-analytics.tsx", 1],
  ["orbit-journey.tsx", 1],
  ["quote-compare.tsx", 1],
  ["referral-desk.tsx", 1],
  ["renewal-desk.tsx", 1],
  ["scout-analytics.tsx", 1],
  ["scout-experiments.tsx", 1],
  ["scout-panel.tsx", 1],
  ["settlement.tsx", 1],
  ["signal-admin.tsx", 1],
  ["signal-answer-engines.tsx", 1],
  ["signal-audience-value.tsx", 1],
  ["signal-studio.tsx", 1],
  ["staff-member.tsx", 1],
]);

/**
 * Count `<Table` opening tags that carry no `empty=` before their tag closes.
 * Brace-depth rather than a line grep: a `<Table>` spans many lines and its
 * props contain both `<` and `>` inside expressions.
 */
function tablesWithoutEmpty(source: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const start = source.indexOf("<Table", from);
    if (start === -1) return count;
    from = start + 6;
    // Not `<Table` if the next character continues an identifier (`<TableFoo`).
    if (/[A-Za-z0-9_]/.test(source[from] ?? "")) continue;

    let depth = 0;
    let index = from;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    if (!/\bempty=/.test(source.slice(from, index))) count += 1;
    from = index;
  }
}

const offenders = readdirSync(ROUTES)
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => ({ file, count: tablesWithoutEmpty(readFileSync(join(ROUTES, file), "utf8")) }))
  .filter((entry) => entry.count > 0);

describe("every table teaches when it is empty", () => {
  it("finds the tables it is meant to be guarding", () => {
    // An empty sweep would pass in perpetuity if `<Table` were ever renamed.
    const total = readdirSync(ROUTES)
      .filter((file) => file.endsWith(".tsx"))
      .reduce((sum, file) => sum + (readFileSync(join(ROUTES, file), "utf8").match(/<Table\b/g) ?? []).length, 0);
    expect(total).toBeGreaterThan(100);
  });

  it("adds no new table on the kit default empty state", () => {
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
