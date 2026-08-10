# ADR-0025: Scoping `provider.viewer` (ROLE-028) to its own provider org

## Status

**Accepted and implemented.** Option 1 (`core_users.providerId` +
`Scope.providerIds`) was chosen: it matches the "one underwriter, one seat"
framing in docs/06 and docs/ui.md, and needs no new join-table surface for a
multi-provider-staff case nobody has asked for yet (Option 2's YAGNI). Option
3 was rejected because it contradicts the interactive-dashboard-login framing
in docs/06.

Implemented in:
- `packages/db/src/schema/core.ts` — `core_users.providerId` (nullable FK to
  `core_providers.id`), migration `packages/db/migrations/0022_aberrant_doorman.sql`.
- `packages/core/src/rbac.ts` — `Scope.providerIds`, deliberately **not**
  read by `scopeAllows()`/`can()` (see the doc comment on the field) since
  `Subject` carries no `providerId` dimension; wiring it into the generic
  fail-closed check would lock a `provider.viewer` out of every other
  permission it holds the moment the field is absent.
- `packages/core/src/approvals.ts`'s `grantsFor()` — derives `providerIds`
  live from `core_users.providerId` on every grant read, rather than
  authoring it per-invite like `teamIds`, since a provider contact's identity
  doesn't change per role assignment.
- `apps/api/src/resources.ts`'s `data-products` `rowVisible` — intersects the
  actor's `providerIds` against `subscribersJson`'s active (non-suspended)
  subscriber ids. A `provider.viewer` with no `providerId` recorded (not yet
  assigned) falls back to the pre-existing published-only view instead of
  being locked out.
- `packages/core/src/seed.ts` — a seeded `provider.viewer` persona
  (`yasmin.faris@gonxt.ae`) assigned to Falcon Insurance, for journey/e2e
  parity with every other role.

Test coverage: `apps/api/src/resources.test.ts`, `packages/core/src/approvals.test.ts`.

## Context

`apps/api/src/resources.ts`'s `data-products` resource (docs/modules/scout.md,
ROLE-028) already has a `rowVisible` predicate
(`apps/api/src/resources.ts:445-463`) that hides unpublished/draft products
from `provider.viewer`. That predicate does **not** scope a `provider.viewer`
down to only the products *their own* provider org subscribed to — it shows
every published product tenant-wide.

`scout_data_products.subscribersJson` (`packages/db/src/schema/scout.ts:110`)
already records which providers subscribed to a given product. The missing
piece is not the data — it's that nothing in the system currently answers
"which `core_providers.id` does this logged-in user represent?":

- `packages/core/src/rbac.ts`'s `Scope` has `teamIds` / `productLines` /
  `modules` — no `providerIds` dimension.
- `core_users` has no `providerId` (or similar) column. `core_products`
  has one (`packages/db/src/schema/core.ts:172`) but that ties a *product* to
  its underwriting provider, unrelated to a *person's* login identity.
- No onboarding/staff path (`apps/api/src/routes/onboarding.ts`,
  `apps/api/src/routes/staff.ts`) ever sets a provider affiliation on a user.
- The existing `partner` `ActorKind` (`packages/core/src/rbac.ts:23`) is only
  ever constructed for API-key/machine callers (`apps/api/src/auth.ts:241`),
  not interactive dashboard logins — and docs/06's description of
  `provider.viewer` ("an underwriter's read-only seat") reads as a human
  logging into the web app, not a machine caller.

So closing ROLE-028 fully means deciding how a human user's provider
affiliation is established and stored, not just adding a field to `Scope` and
threading it through — that's why this is an ADR, not a `rowVisible` patch.

## Options

1. **`core_users.providerId` (nullable FK to `core_providers.id`)** + a new
   `Scope.providerIds` dimension, populated from it when grants are built
   (`ctxFor`/`entitledGrants`). `rowVisible` then checks
   `row.subscribersJson` against the actor's scoped `providerIds`. Simplest
   model; assumes one provider per user, which matches "an underwriter's
   seat" but would need a join table instead if a person ever represents more
   than one provider org.
2. **A `core_user_providers` join table** (many-to-many) if multi-provider
   staff (e.g., a broker consultant seconded across two insurers) is a real
   case. More correct, more migration/UI surface for a case that may not
   exist yet.
3. **Provision `provider.viewer` as an API-key-only `partner` actor**
   (reusing the existing machine-caller path instead of a new human-user
   field). Avoids new schema, but contradicts the "read-only seat" /
   dashboard-login framing in docs/06 and docs/ui.md — a provider's
   underwriter almost certainly needs an interactive login, not just API
   scopes.

No option above is obviously correct without knowing whether tenants expect
one seat per provider org or shared staff across providers — a product
decision, not a schema one.

## Consequence for existing `provider.viewer` users

A `provider.viewer` seeded/invited before this change has `providerId: null`
until an operator sets it. Until then, they keep the pre-existing
tenant-wide published-product view rather than being locked out — this is
the documented fallback in `rowVisible`, not a bug. Closing the gap
per-tenant is an operational follow-up (setting `core_users.providerId` on
existing provider seats), not further code.

## References

- `apps/api/src/resources.ts:445-463` — current `rowVisible`, comment
  pointing at this gap.
- `packages/core/src/rbac.ts:8-15` — `Scope` interface.
- `packages/db/src/schema/scout.ts:100-117` — `scout_data_products`,
  `subscribersJson`.
- `docs/06-roles-and-journeys.md:24`, `docs/17-user-spec-benchmark.md:255`,
  `docs/ui.md:154` — ROLE-028 spec language.
