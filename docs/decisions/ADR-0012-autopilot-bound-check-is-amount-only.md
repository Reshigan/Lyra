# ADR-0012 — SIGNAL autopilot's bound check is amount-vs-bound only

- Status: accepted
- Date: 2026-07-31
- Context: docs/modules/signal.md §2.3 (autopilot), CLAUDE.md §4 (human-in-the-loop)

## Context

`signal_campaigns` carries two fields that both look like they gate autonomy:
`autonomyLevel` (`draft|suggest|act|act_with_approval`) and
`budgetJson.autopilotBoundMinor`. The spec text doesn't spell out how a
proposed move's `act` vs `act_with_approval` routing is decided when both are
present, and packages/core/src/seed/signal.ts (the only prior artifact) never
ran the actual math — it hand-authored `signal_budget_moves` rows with
whichever `approvedBy` the narrative wanted.

Cross-referencing every seed move against its campaign settled it:

- `brandToSearch`, amountMinor 800,000, campaign `brandDec`
  (`autonomyLevel: "act_with_approval"`, `autopilotBoundMinor: 1,000,000`) —
  `approvedBy: "auto"`, despite the campaign's own autonomy level being
  `act_with_approval`.
- `januaryUplift`, amountMinor 1,500,000, same 1,000,000 bound —
  `approvedBy: "pending"`, needed a human.

If `autonomyLevel` drove the decision, `brandToSearch` should have required
approval too. It didn't. The only variable that explains both outcomes is
amount vs bound.

## Decision

`boundCheck(amountMinor, boundMinor)` (apps/api/src/engines/signal-autopilot.ts)
decides `act` vs `act_with_approval` purely by comparing the proposed move's
amount to the campaign's configured bound, inclusive at the boundary (an
amount exactly equal to the bound still auto-executes — no seed example sits
exactly on a bound, so this half of the call is a genuine choice, not a
seed-derived fact).

`autonomyLevel` keeps a different job: it gates whether autopilot evaluates a
campaign at all. Only `act` and `act_with_approval` campaigns are evaluated;
`draft` and `suggest` are skipped entirely (skipped, not evaluated-and-declined
— no `signal.autopilot.evaluated` audit marker is written for them, since the
autopilot never looked at them).

When a campaign carries no `autopilotBoundMinor`, the autopilot falls back to
a hardcoded `DEFAULT_BOUND_MINOR = 100_000` (AED 1,000 minor units — the
smallest bound the seed narrative uses) rather than inventing new config
plumbing for a value nothing in the schema currently models.

## Consequences

- `act_with_approval` on a campaign is not "always ask a human" — it's "ask a
  human once a proposed move gets big enough". A campaign can auto-execute
  many small in-bound moves under `act_with_approval` and still land in the
  approval queue the moment one move crosses its bound.
- The approval path reuses `APPROVAL_POLICIES["signal.budget_move"]`
  (packages/core/src/approvals.ts) unchanged — this ADR is about routing into
  that gate, not about the gate itself.
