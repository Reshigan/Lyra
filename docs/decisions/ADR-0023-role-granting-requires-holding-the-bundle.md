# ADR-0023: role-granting requires holding the bundle you grant

## Status

Accepted. One follow-up decision flagged to the user, unresolved (see below).

## Context

`POST /v1/core/user-roles` (generic CRUD) let any actor holding the flat
`core:roles:assign` permission grant *any* role to *any* user, with no check
that the granting actor's own RBAC bundle actually covers what the granted
role confers. In practice only `tenant.admin` holds `core:roles:assign` (it's
the sole role with `core:*:*`), and `tenant.admin`'s bundle is deliberately
read-only across axis/orbit/signal/scout/north/ledger (`packages/core/src/rbac.ts`).
That meant `tenant.admin` — a role that cannot itself create an axis case,
send an orbit message, or launch a signal campaign — could nonetheless mint a
user holding `axis.agent`, `orbit.agent`, or any other write-capable
operational role. A classic privilege-escalation-via-provisioning bug.

The parallel, purpose-built staff routes (`inviteStaff`, `changeRoles` in
`apps/api/src/engines/staff.ts`) already close this with `assertCanGrant`:
"nobody hands out authority they do not hold." The generic CRUD path was a
second, unguarded door to the same effect.

## Decision

`user-roles` create now runs through the same `assertCanGrant` boundary via a
`beforeWrite` hook in `apps/api/src/resources.ts`: the role being granted is
loaded, its bundle expanded, and every permission in it is checked against the
granting actor's own permissions. Refused with 403 if the actor lacks any of
them. This applies uniformly — CRUD and the staff routes now enforce the
identical invariant, no exceptions.

We did **not** widen `tenant.admin`'s bundle to make this convenient. That
bundle's read-only shape across operational modules is itself a deliberate,
tested boundary (`api-keys.test.ts` asserts `tenant.admin` cannot mint an API
key scoped to `axis:policies:create`); punching module-write holes in it to
let it grant module-write roles would trade one escalation path for another.

## Consequence surfaced, not resolved

Auditing which roles `tenant.admin` can legitimately grant under this
invariant surfaced a systemic gap: **every module's baseline operational role
(`axis.agent`, `orbit.agent`, `signal.marketer`, `scout.pm`, ...) requires
write permissions tenant.admin does not hold**, and `tenant.admin` is the
*only* seeded role holding `core:roles:assign` at all. Under strict
least-privilege, no seeded persona can currently onboard a new hire into any
operational role through this API — only into read-only/analytics-shaped
roles (e.g. `north.board`, which tenant.admin *can* legitimately grant, and
which `journeys.test.ts`'s J-A2 test now uses).

`docs/06-roles-and-journeys.md` names `tenant.admin` as J-A2's actor for
inviting "a new teammate" generally, which implicitly assumed onboarding into
operational roles was possible. It currently is not, for any module.

This is a product/security-policy decision, not a bug fix, so it is flagged
rather than resolved here. Two directions, not mutually exclusive:

1. Grant `tenant.admin` exactly the baseline write permissions each module's
   entry-level role needs (a curated, audited list) — a real widening of
   `tenant.admin`, done deliberately with its own ADR and tests, not as a
   side effect of a bug fix.
2. Introduce a scoped provisioning permission — e.g. a module lead
   (`axis.lead`, `orbit.lead`, ...) gets `core:roles:assign` scoped to their
   own module/team, matching "team lead invites their own teammate" rather
   than routing all onboarding through tenant.admin.

No code change should be made toward either direction without that decision.

## References

- `apps/api/src/engines/staff.ts` — `assertCanGrant`, `bundleOf`.
- `apps/api/src/resources.ts` — `user-roles` resource, `beforeWrite` hook.
- `apps/api/src/journeys.test.ts` — J-A2 "a new teammate", plus the new
  regression test proving `tenant.admin` cannot grant `axis.agent`.
- `packages/core/src/rbac.ts` — `tenant.admin`, `axis.agent`, `north.board`
  bundles.
