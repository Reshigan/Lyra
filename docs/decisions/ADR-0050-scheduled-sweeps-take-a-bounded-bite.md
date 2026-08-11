# ADR-0050 — Scheduled sweeps take a bounded bite, or say why they cannot

Status: accepted · 2026-08-11

## Context

`apps/api/src/index.ts`'s cron handler runs every sweep for every tenant inside
one Worker invocation: outbox drain, policy lifecycle, renewals, routing,
budget autopilot, due schedules, delegation expiry, and at 02:00Z the backup,
audit anchor and snapshotter. All of it shares one CPU budget.

None of the sweeps had a row ceiling. Each one issued `select … where …` with
no `limit`, so the query's cost tracked the size of the book rather than the
size of the work: `sweepPolicyLifecycle`'s on-risk pass reads every active
policy with a payment plan, every tick, forever. A tenant with a large book
would not fail loudly — it would exhaust the invocation partway through its own
sweep, and every tenant queued behind it in the loop would silently not get a
tick at all. Tenants are iterated in a stable order, so the same tail would be
starved on every tick.

## Decision

A scheduled sweep takes at most `SWEEP_MAX` rows per tick
(`apps/api/src/engines/sweep.ts`, currently 500), ordered oldest-first.

This is only sound when processing a row removes it from its own result set,
which makes the overflow the next tick's head of queue rather than work that
never happens. Capped on that basis:

| Sweep | Query | What clears the row |
| --- | --- | --- |
| `sweepRouting` | first-response breaches | stamps `frtBreachedAt`, which the predicate requires null |
| `sweepRouting` | resolution breaches | stamps `resolutionBreachedAt`, likewise |
| `sweepRouting` | stale agent presence | sets `status` to `offline`, off the `available` predicate |
| `sweepPolicyLifecycle` | policies due to incept | moves `status` off `bound` |
| `sweepPolicyLifecycle` | policies past term end | moves `status` to `expired` |

`sweepRouting`'s inner loop over one absent agent's held conversations is left
alone: it is bounded by a single agent's caseload, not by the book.

## What stays uncapped, and why

**`sweepPolicyLifecycle`'s on-risk instalment pass** — this is the one that
actually scales with the book, and it is the one that cannot take this cap.
Whether an instalment was missed is decided by `missedInstalment()` reading
`paymentPlanJson` in JS; a policy that is checked and found fine stays in the
result set, so a cap would re-read the same head of the book every tick and
never reach anything past it. Starving a lapse is worse than a slow scan:
cover stays on risk that should have come off it. Bounding this properly needs
a `next_instalment_due_at` column on `axis_policies`, written when a plan is
set or an instalment is paid, so the predicate can do the filtering the JSON
parse does today. That is a migration plus a backfill and is not in this
change.

**`sweepRenewals`** and **`sweepWhitespace`** are already bounded, by a window
rather than a limit: renewals reads only policies expiring inside
`WINDOW_DAYS`, whitespace only quote responses inside `LOOKBACK_MS`. Their cost
tracks renewal and quote volume in a fixed period, which is the rate the
business actually runs at. `runBudgetAutopilot` carried its own `limit(200)`
already.

## Consequences

- A tenant whose backlog exceeds the cap drains over successive ticks instead
  of in one. At the cron cadence and 500 rows a tick that is a soft ramp, not a
  stall — and it is strictly better than the invocation dying mid-loop.
- The cap is a constant, not tenant config: a tenant that could raise it is
  exactly the tenant whose neighbours would pay for it.
- `orbit-routing.test.ts` holds the guard — `SWEEP_MAX + 3` breaching
  conversations with descending due dates against ascending ids, swept three
  times, asserting the cap, the oldest-first order and that the remainder does
  land on the following tick. A future sweep that adds a `limit` without the
  clears-its-own-row property has no such test and should not be believed.
