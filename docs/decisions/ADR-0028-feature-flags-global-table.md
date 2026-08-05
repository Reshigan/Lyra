# ADR-0028 — Feature flags are the first platform-global table

- Status: accepted
- Date: 2026-08-03
- Context: docs/02-architecture.md §9, CLAUDE.md §1 (tenancy first)

## Context

CLAUDE.md rule 1 is "every table has `tenant_id`; every query goes through
`withTenant`." Feature flags need to exist before any tenant does (a flag
gates a capability for tenants that haven't signed up yet), can target zero,
one, some, or all tenants at once, and are read on the hot path of nearly
every request if wired in generally — a per-tenant row set would mean writing
N rows for one toggle and reading N rows to answer "is this on for tenant X",
for a table that is small (dozens of rows, not millions).

## Decision

`core_feature_flags` is **platform-global, no `tenant_id` column**, an
explicit, singular exception to rule 1 rather than a pattern to repeat.

Columns: `id`, `key` (unique), `description`, `enabled` (kill-switch default),
`rolloutPercent` (0-100, deterministic hash of `tenantId` decides membership,
not random per request), `targetTenantIdsJson` (explicit allow-list,
overrides rollout percent when non-empty), `updatedBy`, `updatedAt`.

Evaluation is a pure function `flagEnabled(flag, tenantId)`: explicit
allow-list wins if present, else `enabled && hash(tenantId, flag.key) %
100 < rolloutPercent`. No per-tenant override row — a flag is either global
math or an explicit list, not both, so there is never a case where two rules
disagree about one tenant.

Routes live under `/v1/platform/flags` (not any tenant-scoped module path),
gated by `admin:flags:read` (new, sibling of the existing
`admin:flags:write`) and `admin:flags:write` (already exists,
`platform.engineer` already carries it). Toggling a flag is **consequential**
(CLAUDE.md §4): a wrong toggle can turn a capability on for every tenant
simultaneously, which is exactly the blast radius the approval step exists
for. New approval-policy entry in `packages/core/src/approvals.ts`:
`core.flag_toggle`, `dualControl: "always"`, `neverAutoApprove: true` — no
tenant policy can put this on an `auto_approve` allowlist because it isn't a
tenant's policy to set; it's platform-scoped.

## Consequences

- `packages/core`'s tenancy helpers (`withTenant`) are never called for this
  table — any future platform-global table follows this ADR's precedent
  instead of re-deriving the exception.
- A flag with an empty `targetTenantIdsJson` and `rolloutPercent: 0` is off
  for everyone despite `enabled: true`; `enabled: false` is a hard kill
  regardless of percent or allow-list — the kill-switch always wins, checked
  first in `flagEnabled()`.
- No per-tenant UI to "see my flags" is implied by this ADR; if that's wanted
  later it's a read-only projection of this table filtered by
  `flagEnabled(flag, ctx.tenantId)`, not a new table.
