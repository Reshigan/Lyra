# ADR-0061: Shell-per-module (NORTH reference build)

**Status:** accepted
**Date:** 2026-08-16
**Context:** docs/superpowers/specs/2026-08-15-north-shell-fork-design.md, docs/superpowers/plans/2026-08-16-north-shell-fork.md

## Decision

NORTH's nine screens (`north/brief`, `north/explorer`, `north/anomalies`,
`north/whatif`, `north/board`, `north/board/:id/file`, `north/decisions`,
`north/admin`, `north/dev`) move off the shared `Shell`/`workspace.tsx`
layout (introduced by commit `212ef48`) onto their own `NorthShell`
component and `north-shell.tsx` layout route. This reverses `212ef48`'s
single-shell direction, but only for the five module prefixes
(north/axis/orbit/signal/scout) — AXIS/ORBIT/SIGNAL/SCOUT get their own
follow-on specs and are not built here. Every non-module area (ledger,
admin, distribution, settings, platform, onboarding, design, search) keeps
today's shared `Shell` unchanged.

## Scope

**Built in this ADR's scope:**
- `bootstrapSession()` — extracted from `workspace.tsx`'s loader into
  `apps/web/app/session.server.ts`, called identically by `workspace.tsx`
  and `north-shell.tsx`.
- `availableShellsForRoles` — a pure roles → workspace-slugs function, added
  to `packages/core/src/lens.ts` (core-side canonical definition) and
  duplicated web-side in `apps/web/app/routing.ts` (apps/web has no
  dependency on `@lyra/core`; `packages/core` may not depend on an app —
  same convention `apps/mobile/src/workspace.ts` already follows for the
  same reason).
- `NorthShell` — its own nav rail (only `/north/*` destinations), the
  `--module-north` accent, Meridian scrubber, and the multi-role switcher.
- `LYRA_MODULES` build-time flag + `shouldInclude()` route-manifest gate.
- The multi-role switcher (`ModuleSwitcher`/`ModuleLink`, `@lyra/ui`) —
  generic, reusable by any future module shell.

**Explicitly deferred:** `AxisShell`, `OrbitShell`, `SignalShell`,
`ScoutShell`, a compliance shell, the mapping of non-module shared screens
(ledger, distribution, admin/*, platform, settings) into a persona shell,
and a shared `ShellChrome` abstraction (one module's chrome is not enough
evidence for what a shared component should generalize over — revisit once
a second module shell exists).

## Shared-bootstrap boundary

Tenancy, RBAC, and audit guarantees (CLAUDE.md rule 1) live in exactly one
place — `bootstrapSession()` — regardless of how many shells exist. Every
module shell's layout route calls it identically; none re-implements
`fetchMe`, the 401 redirect, or the inbox/names batching.

## ADR-0052 narrowing

ADR-0052 forbids mounting a second switcher widget beside a rail that
already lists every destination the actor can reach — one shared rail, one
list, no redundant second control. Under this design there is no longer one
shared rail: each module shell has its own rail, scoped to only that
module's own screens. The multi-role switcher introduced here is **not** a
redundant second list over the same rail — it is the only way to reach a
second, disjoint rail belonging to a different shell, and it renders only
when `session.availableShells.length > 1`. ADR-0052's reasoning still holds
within any one shell; this ADR narrows it to not extend to choosing between
shells.

## Deviations from the original design spec (see the implementation plan's
Global Constraints for full detail)

1. `bootstrapSession` lives in `apps/web/app/session.server.ts`, not
   literally "in packages/core" — apps/web has no `@lyra/core` dependency.
2. `?asOf=` reuses `apps/api`'s pre-existing `to` query param
   (`ListQuery.to`, `apps/api/src/http.ts:81`) — no new backend code.
3. `north-whatif.tsx`'s scenario picker already uses `?id=`, not
   `?scenario=`; this ADR's scope does not touch that screen's query
   contract.
4. Meridian stays single-day; projection is a plain link to `/north/whatif`,
   not a Meridian mode.

## Naming note

"Horizon" (the user-provided mockup's working name) and Meridian's
"projection" mode are both used informally in prior design discussion for
different concepts — flagged here so a future reader does not conflate
the mockup reference name with the scrubber's forward-projection state.

## Consequences

- A fourth shell (after NORTH, and eventually AXIS/ORBIT/SIGNAL/SCOUT) adds
  one layout route + one shell component + one `shouldInclude()` entry —
  the seam is proven, not theoretical.
- `LYRA_MODULES=north pnpm build` produces a route manifest with zero
  AXIS/ORBIT/SIGNAL/SCOUT routes (`apps/web/app/routes.test.ts`), so a
  standalone NORTH Worker build is available whenever a real deploy target
  needs one — `wrangler.jsonc` gets no new `env` block in this ADR's scope.
