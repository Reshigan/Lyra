/**
 * How many rows one scheduled sweep will take in a single tick.
 *
 * The cron handler (apps/api/src/index.ts) runs every sweep for every tenant
 * inside one Worker invocation, so a query with no ceiling is a scan of a whole
 * book — and the first tenant with a large one starves every tenant queued
 * behind it when the invocation runs out of CPU. A sweep that stops at the cap
 * is not a sweep that skips work: each capped query is written so a processed
 * row leaves its own result set (a breach stamps `frtBreachedAt`, an inception
 * moves the status off `bound`), and the rows are taken oldest-first, so the
 * remainder is simply the next tick's head of queue.
 *
 * Only apply this to a query with that property. A cap on a query whose rows
 * stay in the set after processing — the on-risk instalment pass in
 * axis-lifecycle.ts is the one that does — silently starves everything past
 * the cap forever (ADR-0050).
 */
export const SWEEP_MAX = 500;
