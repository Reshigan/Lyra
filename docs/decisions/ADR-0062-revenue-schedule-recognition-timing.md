# ADR-0062 — Revenue recognition only for past periods (`lt`, not `lte`)

Status: accepted · 2026-08-17
Context: docs/superpowers/plans/2026-08-17-revenue-lines-group-c-billing-data-products.md (Task 4), docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md (Group C)

## Decision

`postRecognitions()` in `apps/api/src/engines/billing.ts` recognizes a
`ledgerRevenueSchedules` row only when its `period` is strictly before the
sweep's current period (`lt`, not `lte`).

## Why

The Task 4 plan's own sample code used `lte`, paired with a sample test that
called `sweepBilling()` twice at the same `ctx.now` and expected the second
call to recognize a schedule row the first call had just created. Verified
empirically: under `lte`, `raiseInvoices` and `postRecognitions` run inside
the same `sweepBilling()` invocation, sharing one `ctx.now` — the row is
recognized on the *first* call, not the second, contradicting the plan's own
test. `lte` collapses invoicing and recognition into the same instant,
defeating the purpose of `ledgerRevenueSchedules`'s `scheduled` → `recognized`
state machine: deferred revenue must not recognize before its period has
elapsed.

## Consequence

Test rewritten to advance time by one period between sweeps rather than
calling twice at the same `ctx.now`. No other code path in this codebase does
period-based recognition today, so this sets precedent for Task 5's F3 path
if it ever needs a scheduled (non-inline) recognition sweep.
