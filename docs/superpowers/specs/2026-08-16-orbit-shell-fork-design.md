# Shell-per-module: ORBIT fork — design

**Status:** proposed
**Context:** ADR-0061 (shell-per-module, NORTH reference build), `docs/superpowers/specs/2026-08-16-axis-shell-fork-design.md` (AXIS fork, same pattern, second instance), `apps/web/app/components/axis-shell.tsx`, `apps/web/app/routing.ts`, ADR-0054 (`orbit.retention` → `axis` cross-link)

## Why

ADR-0061 built the shared shell-per-module mechanism and deferred AXIS/ORBIT/SIGNAL/SCOUT. AXIS's fork proved the pattern repeats cleanly for a second module. This spec is the addition for ORBIT, second of the four.

## Scope

**In scope:** `OrbitShell` component + `orbit-shell.tsx` layout route, using every mechanism ADR-0061 already built, unchanged. No new shared machinery.

**Out of scope:** SIGNAL/SCOUT (separate specs, same pattern). Meridian — NORTH-only, ORBIT gets no scrubber. Any change to non-module shared screens. The `orbit.retention` → `axis` ADR-0054 cross-link — unchanged shared logic in `lens.ts`/`routing.ts`, not touched by this fork; verified, not modified.

## Rail destinations

Read from `apps/web/app/routing.ts`'s `HIDDEN_ROUTES` comments — every path already documented as "linked from the ORBIT workspace tools list" is a rail destination, same convention AXIS's fork used. Order follows `routes.ts`'s declaration order:

1. `orbit/console` — operator console
2. `orbit/supervisor` — live supervisor view
3. `orbit/save` — save/recovery flows
4. `orbit/pipeline` — conversation pipeline
5. `orbit/quality` — quality review
6. `orbit/analytics` — operations analytics
7. `orbit/admin` — admin settings
8. `orbit/dev` — dev sandbox

**Not on the rail** (detail routes opened from a list, same convention as `axis/policies/:id/detail`): `orbit/conversations/:id/thread` (opens from a single conversation record), `orbit/journeys/:id/builder` (opens one journey's steps from the journeys list). These move under `orbit-shell.tsx`'s layout (same shell chrome) but are not rail items.

## Architecture (unchanged from ADR-0061 / AXIS precedent)

- `orbit-shell.tsx` layout route: calls `bootstrapSession()`, checks `session.availableShells.includes("orbit")`, throws 403 if not, renders `<OrbitShell session={session}><Outlet /></OrbitShell>`. Copy of `axis-shell.tsx` with the module string swapped.
- `OrbitShell` component (`apps/web/app/components/orbit-shell.tsx`): copy of `AxisShell`'s structure — own nav rail (8 destinations above), `--module-orbit` accent (already defined in `packages/ui/src/tokens.css`, no new token needed), multi-role switcher when `availableShells.length > 1`, brand name/logo/colors from `session.brand`. No Meridian.
- `routes.ts`: the existing `shouldInclude("orbit") ? [...] : []` block moves from `layout("routes/workspace.tsx", [...])` to its own `layout("routes/orbit-shell.tsx", [...])`. All 10 ORBIT routes (8 rail + 2 detail) move together.
- `useShellData` swap: only 3 files call it today — `orbit-admin.tsx`, `orbit-dev.tsx`, `conversation.tsx` (the `:id/thread` detail route) — switch to `useOrbitSessionData()`. The other 6 rail files and `orbit-journey.tsx` already use their own `useLoaderData()` and need only the layout move, no data-hook swap.
- Roles resolving to `orbit`: `orbit.agent`, `orbit.lead`, `orbit.retention`, `orbit.partners`, `orbit.admin` — all via the existing generic module-prefix rule in `lens.ts`/`routing.ts`, no new special case needed. `orbit.retention`'s existing ADR-0054 exception into `axis` is untouched shared logic; this fork's testing must confirm it still resolves to `["orbit", "axis"]` (2 shells) after the move, since `OrbitShell`'s multi-role switcher must show the AXIS link too for that role.

## Testing (CLAUDE.md TDD, non-negotiable)

- Failing `@journey:J-ORBIT-SHELL` Playwright spec first: an actor with an `orbit.*`-resolving role (not `orbit.retention`) lands in `OrbitShell`, sees exactly the 8 rail destinations listed above, no Meridian, no other module's links.
- 403 (not 401) for an authenticated actor with no `orbit.*`-resolving role hitting any `orbit/*` path — port of AXIS's `shell.roles.test.ts` case.
- Regression case: `orbit.retention` actor's `availableShells` still includes both `"orbit"` and `"axis"` after the route move (guards against silently breaking ADR-0054 while relocating the block in `routes.ts`).
- Contract test extension: `LYRA_MODULES=orbit` build's route manifest contains ORBIT routes and excludes north/axis/signal/scout (extends the existing `LYRA_MODULES=axis` contract test).
- Unit test: `orbit-shell.tsx` loader 403s when `availableShells` excludes `"orbit"`.

## ADR

No new ADR. ADR-0061 already names the pattern; this spec fulfills the ORBIT deferral. ADR-0054 is read, not modified — this fork's job is to not break it, verified by the regression test above.

## Self-review

- Placeholders: none.
- Internal consistency: rail list (8) + detail list (2) = 10, matches the Explore agent's verified count from `routes.ts`. `useShellData` swap count (3 files) verified against actual imports, not assumed from AXIS's count (15) — smaller module, smaller swap.
- Scope: single module (ORBIT), reuses 100% of ADR-0061's shared mechanisms, adds nothing new. Explicitly does not touch the ADR-0054 exception logic itself — only tests that it survives.
- Ambiguity: none — rail promotion order is not a judgment call (same `HIDDEN_ROUTES`-comment convention as AXIS). The one thing that could be missed (ADR-0054 regression) is called out explicitly with its own test.
