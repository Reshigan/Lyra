# ADR-0013 — Six resources are delete-exempt by design; a `status`/`state` column is the only way out

- Status: accepted
- Date: 2026-07-31
- Context: CLAUDE.md:4-6 (ambiguous spec → ADR), CLAUDE.md §12 (transaction
  integrity), apps/api/src/resources.ts, apps/api/src/crud.ts:469-492,
  packages/db/src/schema/axis.ts, orbit.ts, signal.ts, scout.ts

## Context

`apps/api/src/crud.ts` only registers a `DELETE /:id` route for a resource when
its `perms.remove` is set and it is not `immutable`:

```
if (r.perms.remove && !r.immutable) {
  app.delete("/:id", ...)
```

(crud.ts:471). A resource whose `perms` object has no `remove` key therefore has
no delete endpoint at all — not a 403, an absent route. An audit of
`apps/api/src/resources.ts` found six resources, across four modules, that
follow exactly this shape: they have a real `create`/`update` surface (this is
not the same as the read-only resources built from `ro()`) but never coin a
`remove` permission:

- `axis` **policies** (resources.ts:216-220) and **claims** (resources.ts:231-235)
- `orbit` **partners** (resources.ts:258-262) and **renewals** (resources.ts:252-255)
- `signal` **campaigns** (resources.ts:279-289)
- `scout` **whitespaces** (resources.ts:319-322)

This is consistent, not accidental, but nothing recorded *why* — a future PR
adding `remove: "axis:policies:delete"` would look like a straightforward gap
fill. It isn't. Each of these six carries a `status`/`state` column with a
terminal value, and each is either a regulatory/financial record, a
counterparty diligence record, or referenced by other tables for reporting —
reasons that don't repeat identically across the six, so each is recorded
below rather than hand-waved as one policy.

### axis policies — `packages/db/src/schema/axis.ts:122-151`

`status` is `active|lapsed|cancelled|renewed` (axis.ts:142). There is no
`deletedAt` column on this table at all — soft delete isn't even available as a
fallback. A policy is the underwriting record of a bound contract: its
`create` is approval-gated on `axis.bind` with `amountField: "premiumMinor"`
(resources.ts:220), it is what `axis_escrow_batches` reconciles provider
payments against, and `axis_claims.policyId` (axis.ts:213) points into it.
Deleting a policy would erase what was sold, at what premium, and orphan any
claim filed against it. The lifecycle moves forward through `status` only;
`cancelled` is the terminal non-renewal state.

### axis claims — `packages/db/src/schema/axis.ts:207-232`

`status` is `reported|assessing|approved|rejected|settled|withdrawn`
(axis.ts:222). No `deletedAt` column here either. The schema comment at
axis.ts:207 calls this "the other consequential AXIS flow (guidance is
regulated — docs/12)"; settlement is approval-gated via
`axis.claim_settlement` with `amountField: "settledMinor"` (resources.ts:235).
A claim row is FNOL + assessment + settlement evidence — `withdrawn` is the
terminal state for a claim that doesn't pay out, not deletion of the record
that it was filed and assessed.

### orbit renewals — `packages/db/src/schema/orbit.ts:57-80`

`state` is `scheduled|offered|accepted|lost` (orbit.ts:68), no `deletedAt`.
Each row is unique per policy (`orbit_renewals_policy_uq` on `policyRef`,
orbit.ts:78) and is raised by the scheduled tick (be1063f, "orbit: raise
renewals on the scheduled tick"), so it is system-derived rather than
user-authored. It still has to preserve which `strategy`
(`auto_requote|human|do_not_contact`) was applied and why an offer ended up
`lost`, since that's the renewal-rate reporting surface. `lost` and `accepted`
are the terminal states.

### orbit partners — `packages/db/src/schema/orbit.ts:119-170`

This table's own schema comment already states the reason CRUD delete would
break: "a live partner can be paused for a billing dispute without losing the
record that their diligence and agreement are done — pausing must not mean
re-onboarding" (orbit.ts:121-124). Concretely: `status` defaults to `active`
and moves via `suspendedAt`/`suspendedReason`/`terminatedAt`; `stage` walks a
separate onboarding ladder (`prospect > applied > screening > diligence >
agreement > integration > sandbox > live`, with `suspended`/`terminated`
reachable from any stage) that "is walked by the onboarding engine, never set
by hand" (orbit.ts:126-129). The row also carries diligence evidence
(`screeningId` → `compliance_screenings`, `riskRating`, `legalName`,
`registrationNo`, `taxId`) and the `agreementId` governing the relationship.
Deleting it would destroy the counterparty's compliance trail, not just a
contact record. No `deletedAt` column.

### signal campaigns — `packages/db/src/schema/signal.ts:23-47`

`state` is `draft|review|scheduled|live|paused|ended` (signal.ts:33). This is
the one exception worth flagging on its own: the table *does* carry a
`deletedAt` column (signal.ts:41), but nothing activates it — resources.ts
grants no `remove` permission, so crud.ts:471's guard never registers the
`DELETE` route, and a grep of `apps/api/src/routes/*.ts` finds no other code
path that writes to `signalCampaigns.deletedAt`. The column is vestigial under
the current permission model. The reason to keep it inert: a campaign is
joined by `signal_attribution_events.campaignId` and `signal_spend.campaignId`
(both indexed on `(tenantId, campaignId, ...)` for reporting, signal.ts:150,
signal.ts:171) and is the subject of the `signal_budget_moves` autopilot
ledger (see ADR-0012). Deleting a campaign would silently break attribution
and CAC joins that assume the row still exists. `ended` is the terminal
state; `paused` already covers "stop without erasing."

### scout whitespaces — `packages/db/src/schema/scout.ts:42-59`

`status` is `candidate|validating|validated|parked` (scout.ts:52), no
`deletedAt`. A whitespace is a derived output of `scout_clusters` /
`scout_signals` clustering (`clusterId` fk, scout.ts:48) and is the subject of
`scout_experiments.whitespaceId` (scout.ts:84) — deleting it would orphan any
experiment that validated or invalidated it. `parked` is the terminal "not
pursuing this" state, kept distinct from `validated` ("pursuing it") so the
history of what was considered and rejected survives.

## Decision

None of axis policies, axis claims, orbit partners, orbit renewals, signal
campaigns or scout whitespaces will ever gain a `remove` permission in
`apps/api/src/resources.ts`. Each is either a regulatory/financial record
(policies, claims), a counterparty diligence record (partners), or a record
other tables depend on for reporting or process integrity (renewals,
campaigns, whitespaces). Every one already models its lifecycle as a
`status`/`state` column reaching a terminal value
(`cancelled`/`withdrawn`/`lost`/`terminated`/`ended`/`parked`) through the
existing `update` permission — that state transition is the only exit, and it
is already wired.

No code changes accompany this ADR. The pattern is already fully implemented;
this records the reason so it survives the next refactor of
`apps/api/src/resources.ts`.

## Consequences

- No UI affordance should be built to hard-delete these six resources. A
  request for one should be redirected to the relevant status/state
  transition instead (e.g. cancel a policy, withdraw a claim, suspend or
  terminate a partner, mark a campaign `ended`, park a whitespace).
- `signal_campaigns.deletedAt` (signal.ts:41) is dead weight under this
  pattern: no code path sets it. This ADR does not remove the column —
  migrations are forward-only (CLAUDE.md §9) and a column drop is out of
  scope here — but it flags the inconsistency for whoever next touches
  `signal.ts` so it isn't mistaken for a live soft-delete path.
- The rule generalizes: a future resource with an approval-gated financial or
  regulatory lifecycle should model its terminal state in a `status`/`state`
  column and simply omit `remove` from its `perms` in resources.ts. No change
  to `crud.ts` is needed to enforce that — DELETE route registration already
  keys off permission presence (crud.ts:471).
