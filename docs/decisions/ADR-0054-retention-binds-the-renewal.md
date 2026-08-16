# ADR-0054 — The retention desk binds its own renewal

Status: accepted · 2026-08-12

## Context

The renewal desk (`apps/web/app/routes/renewal-desk.tsx`) reads
`orbit_renewals` behind `orbit:renewals:read`, and its one consequential
control — "Bind renewal" — posts `/v1/axis/policies/:id/renew`, which
requires `axis:policies:renew` (`apps/api/src/routes/axis.ts:1190`).

No role in the catalogue held both. `orbit.retention` and `orbit.lead` hold
`orbit:renewals:update` but no AXIS write; `axis.lead`/`axis.admin` hold
`axis:policies:renew` but no ORBIT read, so the desk that carries the button
never loads for them. The renewal journey therefore dead-ended in the UI for
every persona: the desk listed what was expiring and offered a control nobody
could use.

## Decision

`orbit.retention` gains `axis:policies:renew`.

The desk's owner completes the desk's work. Retention already holds
`axis:policies:read`, `axis:quotes:create` and `axis:quotes:compare` — it
requotes the expiring term already; binding the successor is the same act
finished rather than a new authority.

Separation of duties is not weakened, because it was never carried by the
permission: `axis.renew` is an approval policy with
`dualControl: "above_threshold"` at 250,000.00 (`packages/core/src/approvals.ts`),
so a renewal over the threshold still routes to a second pair of eyes before
anything binds, and every bind is audited either way.

## Alternatives rejected

**Give `axis.lead` the ORBIT renewal reads.** It makes the AXIS lead the
person who works a retention queue, which is the wrong desk — and it leaves
`orbit.retention` staring at a button it still cannot press.

**Leave it and add a hand-off.** A "send to AXIS" step is a second queue and a
second wait in front of a deadline-driven conversation. Nothing in docs/05 or
docs/06 asks for one.

## Consequences

- A retention agent can complete J-O3 end to end without a role change.
- Renewals above the threshold behave exactly as before: approval first.
- `packages/core/src/rbac.ts` is the only change; the route, the gate and the
  desk are untouched.

## Addendum — 2026-08-16, AXIS shell fork

The AXIS shell fork (`docs/superpowers/plans/2026-08-16-axis-shell-fork.md`)
added a shell-entry gate in `axis-shell.tsx`'s loader, driven by
`availableShellsForRoles()`. Before the fork, `/axis/renewals` lived under
the shared `workspace.tsx` layout with no shell-level gate — `orbit.retention`
reached it on `axis:policies:renew` alone. The fork's new gate would have
403'd `orbit.retention` out of the desk this ADR grants it access to, so
`availableShellsForRoles()` (`packages/core/src/lens.ts`,
`apps/web/app/routing.ts`) carries an explicit `orbit.retention` → `axis`
exception. This restores this ADR's original decision under the new gate;
it does not grant any additional permission beyond what's already decided
above.
