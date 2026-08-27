import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// docs/15 §6 item 10: every error state carries a trace_id and a next step. The
// id itself is on `problem.requestId` (api-error.ts) and every screen that
// renders an ApiError's problem straight through therefore has it for free.
//
// It is lost at one place only: a route that *rebuilds* the problem — narrowing
// `error.problem` into a fresh object literal so it can translate the title, or
// flattening it to a bare string. Eight NORTH-shaped screens do the first and
// all carry `requestId` across; analytics-dashboard did the second and dropped
// it, which is the whole reason this guard exists.
//
// So this walks for the rebuild, not for the render: any `error.problem.title`
// or `error.problem.detail` read inside a route that never mentions
// `requestId` anywhere is a narrowing point that lost the id. Same shape as
// empty-states.test.ts — real source, one contract, a list that shrinks.

const ROUTES = join(__dirname, "routes");

/**
 * Reads the problem but has no id to lose: `file: why`. Empty today — a Map
 * rather than nothing so a genuine exception is admitted with a reason in
 * review instead of the guard being deleted.
 */
const ALLOWED = new Map<string, string>();

const offenders = readdirSync(ROUTES)
  .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
  .filter((file) => {
    const source = readFileSync(join(ROUTES, file), "utf8");
    if (!/\berror\.problem\.(title|detail)\b/.test(source)) return false;
    return !/requestId|<Problem\b|<Gate\b|<RequestId\b/.test(source);
  });

describe("an error state keeps the id support looks it up by", () => {
  it("finds the narrowing points it is meant to be guarding", () => {
    const reading = readdirSync(ROUTES).filter(
      (file) => file.endsWith(".tsx") && /\berror\.problem\b/.test(readFileSync(join(ROUTES, file), "utf8"))
    );
    expect(reading.length).toBeGreaterThan(5);
  });

  it("drops requestId in no route", () => {
    expect(offenders.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });

  it("keeps ALLOWED honest — no entry for a route that no longer offends", () => {
    expect([...ALLOWED.keys()].filter((file) => !offenders.includes(file))).toEqual([]);
  });
});
