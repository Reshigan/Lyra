# ADR-0029 — Platform staff cross-tenant reads reuse the scheduler's per-tenant loop

- Status: accepted
- Date: 2026-08-03
- Context: CLAUDE.md §1 (tenancy first), apps/api/src/index.ts `scheduled()`

## Context

`/platform` (ops overview, SLO burn, incidents rollup, data-health rollup,
deployments) needs read views that span every tenant, for actors
(`platform.admin`/`support`/`engineer`) who are not scoped to any one tenant.
CLAUDE.md rule 1 forbids raw cross-tenant `WHERE`-less queries; every table
still has `tenant_id` and every query still goes through a tenant-scoped
path — platform staff don't get a bypass primitive, they get the same
primitive every scheduled job already uses.

## Decision

Cross-tenant platform reads are a **loop over `activeTenants()`, one
tenant-scoped `Ctx` and query per iteration, results merged in memory** — the
exact shape `apps/api/src/index.ts`'s `scheduled()` already uses for outbox
drain, renewal sweep and the nightly snapshotter. No new query primitive, no
`SELECT * FROM x` without a tenant filter anywhere in the codebase.

Concretely, a platform route (`apps/api/src/routes/platform.ts`) does:

```ts
for (const tenantId of await activeTenants(env)) {
  const ctx = await ctxFor(env, { tenantId, actor, ... }, now);
  if (!can(ctx.actor, requiredPerm, { tenantId })) continue; // per-tenant grant check, not skipped
  rows.push(...await queryScopedToThisTenant(ctx));
}
```

This is read-only by construction (Phase 2 items 1/3/5/9/13 are all reads);
the moment a platform screen needs to *write* into a specific tenant (not
just impersonate — write cross-tenant config, e.g. force-disable a tenant),
that write goes through the normal single-tenant route for that tenant, called
once per target, never a fan-out write helper. This ADR does not authorize a
cross-tenant write primitive; if one is needed later it needs its own ADR.

Fleet size at go-live is small enough (docs/14 roadmap targets) that an
in-process loop is the right cost/complexity trade — no fan-out queue, no
pre-aggregated rollup table. If tenant count later makes the loop too slow
for a request-path read, the fix is a scheduled job that writes a rollup
table (same pattern the nightly snapshotter already uses for NORTH), not a
new cross-tenant query shape.

## Consequences

- Every platform-staff read route is trivially auditable: it is N ordinary,
  already-tested tenant-scoped queries, not one new query shape to review for
  tenant-isolation bugs.
- A tenant that isn't in `activeTenants()` (never existed, or the row itself
  is gone) simply isn't in the rollup — there's no separate "deleted tenant"
  handling to write.
- Latency scales with tenant count. Acceptable at current and near-term
  scale (docs/14); revisit per the rollup-table fallback above if it stops
  being acceptable.
- Referenced by Phase 2 items 1 (ops overview), 3 (SLO), 5 (incidents
  rollup), 9 (data-health rollup) and 13 (deployments) instead of each
  needing its own ADR.
