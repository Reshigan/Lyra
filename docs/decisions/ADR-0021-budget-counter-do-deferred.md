# ADR-0021 — BudgetCounter DO stays a reserved seam; D1-row budget enforcement is the real thing for go-live

- Status: accepted
- Date: 2026-08-01
- Context: docs/02 §5 ("Budget metering per tenant/day in a Durable Object
  counter; hard stop + admin alert at 100%."), docs/10 §2 (`AIBUDGET` /
  `BudgetCounter` binding, canonical list), docs/10 §7 (cost guards: "Per-tenant
  AI budget DO (hard stop)"), packages/model-gateway/src/budget.ts,
  docs/25-go-live-checklist.md §6

## Context

`docs/10-*.md` §2's canonical `wrangler.jsonc` binding list names an
`AIBUDGET` Durable Object (`class_name: "BudgetCounter"`) alongside
`AGENT_ROOM`, `RATE`, and `REALTIME` — all four listed together as one
`durable_objects.bindings` block. Of those four, `RATE` (RateCounter) and
`REALTIME` (UserChannel) were built and wired this go-live pass;
`BudgetCounter` was explicitly excluded from that scope (user chose "Queues,
RateCounter DO, UserChannel DO, 3 Vectorize indexes, Workflows binding,
Analytics Engine/Browser binding" — six items, not seven).

CLAUDE.md rule 15 (seams) treats a documented seam as load-bearing: "Removing
or bypassing a documented seam requires an ADR." `AIBUDGET` is such a seam —
this is that ADR.

## Decision

Budget enforcement today is the D1-row upsert in
`packages/model-gateway/src/budget.ts` (`upsertRow`, `reserve`/`settle`),
already gating every model call with a hard stop at 100% and an admin alert
at `WARN_AT = 0.8`, exactly as docs/02 §5 requires — the DO is named there as
the mechanism for the *fast path under concurrent contention*, not as a
requirement for the enforcement to exist at all. The code already carries
this as a marked simplification:

```ts
// ponytail: the D1 row is the counter. A DO in front of it is the fast path when
// concurrency makes the read-modify-write contend — the reserve/settle shape here
// is the same either way, so that swap is one file.
```

`AIBUDGET`/`BudgetCounter` remains a reserved seam (binding name kept out of
`wrangler.jsonc` until built, no dead code checked in for it) rather than a
built-but-unused Durable Object. Building it now, ahead of any observed D1
contention on `ai_budgets`, would be exactly the "config for a value that
never changes" / speculative-need case the ladder rejects (rung 1).

## Consequences

- docs/25 §6's "AI Gateway configured per docs/10 §3, budget DO enforcing
  tier ceilings" checklist line is satisfied for the *budget enforcement*
  half by the D1-row implementation, not by a DO — tier ceilings ARE
  enforced today. The line should read as AI-Gateway-pending, not
  budget-enforcement-pending.
- Upgrade path, unchanged from the existing ponytail comment: swap
  `upsertRow`'s D1 read-modify-write for a `BudgetCounter` DO call when a
  tenant's concurrent-call volume actually produces read-modify-write
  contention on its `ai_budgets` row — one file (`budget.ts`), the
  `reserve`/`settle` call shape does not change.
- No `wrangler.jsonc` binding is added for `AIBUDGET` until that swap
  happens; adding the binding without the class would be a broken deploy,
  and adding the class without a triggering need would be the bypassed seam
  this ADR exists to avoid.
