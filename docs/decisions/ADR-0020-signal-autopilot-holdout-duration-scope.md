# ADR-0020 — SIGNAL budget-autopilot 14-day holdout run: live-duration claim deferred to staging sign-off

- Status: accepted
- Date: 2026-08-01
- Context: docs/modules/signal.md §8 clause 2 ("Budget autopilot runs 14
  consecutive days against a holdout with full move logs and one-click
  global pause."), docs/25-go-live-checklist.md M4 SIGNAL v1 row,
  apps/api/src/engines/signal-autopilot.ts, apps/api/src/routes/signal.ts,
  apps/api/src/engines/signal-autopilot.test.ts

## Context

Clause 2 bundles three separate claims:

1. **Move logs** — every automated reallocation is a row in
   `signalBudgetMoves` with reason/evidence/approver, reversible for 7 days.
   Real, tested (`signal-autopilot.test.ts`, all `runBudgetAutopilot` cases).
2. **One-click global pause** — a tenant-wide kill switch checked before any
   campaign is evaluated. Was missing entirely before this pass; now built
   end-to-end: `PolicyJson.signalAutopilotPaused` (packages/db/src/json.ts),
   the guard in `runBudgetAutopilot` (signal-autopilot.ts), the
   `signal:autopilot:pause` permission (packages/core/src/rbac.ts,
   `signal.lead` + `signal.admin` via wildcard), and
   `POST /v1/signal/autopilot/{pause,resume}` (apps/api/src/routes/signal.ts).
   Covered by an engine-level test (pause flag → zero moves, zero DB rows)
   and a route-level journey test (permission-gated, toggles and persists
   the tenant's `policyJson`). PASS.
3. **"Runs 14 consecutive days against a holdout"** — the holdout-comparison
   math (`compareHoldout`, upliftBps between an acted cohort and a frozen
   holdout) is real and unit-tested. The daily-trigger idempotency (one
   evaluation per campaign per day, no double-fire on a same-day retick) is
   also real and tested. What is NOT provable by a unit test is the
   duration itself: "ran for 14 consecutive days" is a claim about wall-clock
   elapsed time in a live deployment, not a property of the code. A test
   can fake 14 `ctx.now` values 24 hours apart and prove the mechanism
   behaves correctly at each simulated tick — it cannot prove the autopilot
   actually stayed up and ticked correctly for two real weeks in production
   without human intervention.

## Decision

Split clause 2 rather than leaving it as one PARTIAL line:

- Move logs: PASS, code + tests.
- One-click global pause: PASS, code + tests (this pass).
- 14-consecutive-day live run: deferred to staging/production sign-off, not
  a code gap. The mechanism that makes a 14-day run meaningful (daily
  trigger, idempotency, holdout comparison, and now the pause switch to
  stop it if something goes wrong) is all built and tested. Confirming it
  by demonstrating an actual 14-day run belongs to whoever signs off go-live
  operations, the same way ADR-0019 defers on-prem's live docker-compose run
  to an operator rather than faking it in a unit test.

  Sign-off procedure for whoever owns this: enable the autopilot for one
  pilot tenant/campaign with `autonomyLevel: "act"` or `"act_with_approval"`,
  let the scheduled tick (docs/14 M4) run for 14 real days, confirm
  `signalBudgetMoves` accumulates a plausible daily cadence with no gaps,
  and confirm `POST /v1/signal/autopilot/pause` stops it mid-run if needed.

## Consequences

- No application code changes here beyond what clause 2 already required
  (pause/resume, above). This ADR only scopes the go-live claim.
- docs/25-go-live-checklist.md's M4 row can cite this ADR for the
  live-duration half of clause 2 instead of carrying it as an unscoped
  PARTIAL.
- Same shape as ADR-0014/15/16/17/19: a documented, ADR-scoped remaining
  gap, not a silent claim of full completion.
