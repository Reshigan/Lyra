# Shell-per-module: SIGNAL fork — design

**Status:** proposed
**Context:** ADR-0061 (shell-per-module, NORTH reference build), `docs/superpowers/specs/2026-08-16-axis-shell-fork-design.md`, `docs/superpowers/specs/2026-08-16-orbit-shell-fork-design.md` (same pattern, first two instances), `apps/web/app/components/orbit-shell.tsx`, `apps/web/app/routing.ts`, `docs/modules/signal.md`

## Why

ADR-0061 built the shared shell-per-module mechanism and deferred AXIS/ORBIT/SIGNAL/SCOUT. AXIS and ORBIT's forks proved the pattern repeats cleanly. This spec is the addition for SIGNAL, third of the four.

## Scope

**In scope:** `SignalShell` component + `signal-shell.tsx` layout route, using every mechanism ADR-0061 already built, unchanged. No new shared machinery.

**Out of scope:** SCOUT (separate spec, same pattern). Meridian — NORTH-only, SIGNAL gets no scrubber. Any change to non-module shared screens. No ADR-0054-style cross-link exception exists for SIGNAL — `lens.ts` resolves all `signal.*` roles via the generic module-prefix rule, no special case to preserve.

## Rail destinations

Read from `apps/web/app/routing.ts`'s `HIDDEN_ROUTES` comments — every path documented as linked from the SIGNAL workspace tools list is a rail destination, same convention as AXIS/ORBIT. Order follows `routes.ts`'s declaration order:

1. `signal/cockpit` — growth cockpit
2. `signal/studio` — creative studio
3. `signal/audience-value` — audience & LTV intelligence
4. `signal/answer-engines` — AEO board
5. `signal/experiments` — experiments & attribution
6. `signal/budget` — budget autopilot
7. `signal/analytics` — analytics
8. `signal/admin` — admin settings
9. `signal/dev` — dev sandbox

**Not on the rail** (detail route opened from a list, same convention as `axis/policies/:id/detail`): `signal/creatives/:id/image` — a raw image-proxy loader (streams `/v1/signal/creatives/:id/image` from the API, no page, no shell/session data). This moves under `signal-shell.tsx`'s layout for consistency with the other nine paths but renders no chrome itself and needs no `useShellData`/`useSignalSessionData` swap.

## Architecture (unchanged from ADR-0061 / AXIS+ORBIT precedent)

- `signal-shell.tsx` layout route: calls `bootstrapSession()`, checks `session.availableShells.includes("signal")`, throws 403 if not, renders `<SignalShell session={session}><Outlet /></SignalShell>`. Copy of `orbit-shell.tsx` with the module string swapped.
- `SignalShell` component (`apps/web/app/components/signal-shell.tsx`): copy of `OrbitShell`'s structure — own nav rail (9 destinations above), `--module-signal` accent (already defined in `packages/ui/src/tokens.css`, no new token needed), multi-role switcher when `availableShells.length > 1`, brand name/logo/colors from `session.brand`. No Meridian.
- `routes.ts`: the existing `shouldInclude("signal") ? [...] : []` block moves from `layout("routes/workspace.tsx", [...])` to its own `layout("routes/signal-shell.tsx", [...])`. All 10 SIGNAL routes (9 rail + 1 detail) move together.
- `useShellData` swap: 9 of the 10 route files call it today — `signal-cockpit.tsx`, `signal-studio.tsx`, `signal-audience-value.tsx`, `signal-answer-engines.tsx`, `signal-experiments.tsx`, `signal-budget.tsx`, `signal-analytics.tsx`, `signal-admin.tsx`, `signal-dev.tsx` — switch to `useSignalSessionData()`. `signal-creative-image.tsx` uses no shell data at all (raw loader, no component) and needs only the layout move.
- Roles resolving to `signal`: any `signal.*`-prefixed role, via the existing generic module-prefix rule in `lens.ts`/`routing.ts` (`role.split(".")[0]`) — no new special case, no ADR-0054-style exception (confirmed: `lens.ts`'s only hard-coded cross-link is `orbit.retention` → `axis`; nothing references `signal`).

## Testing (CLAUDE.md TDD, non-negotiable)

- Failing `@journey:J-SIGNAL-SHELL` Playwright spec first: an actor with a `signal.*`-resolving role lands in `SignalShell`, sees exactly the 9 rail destinations listed above, no Meridian, no other module's links.
- 403 (not 401) for an authenticated actor with no `signal.*`-resolving role hitting any `signal/*` path — port of AXIS/ORBIT's `shell.roles.test.ts` case.
- Contract test extension: `LYRA_MODULES=signal` build's route manifest contains SIGNAL routes and excludes north/axis/orbit/scout (extends the existing contract test).
- Unit test: `signal-shell.tsx` loader 403s when `availableShells` excludes `"signal"`.
- Regression: `signal-creative-image.tsx`'s loader keeps streaming the proxied image unchanged after the route move (no data-hook swap, so this is a smoke check that the layout wrap didn't break the raw-Response return path).

## ADR

No new ADR. ADR-0061 already names the pattern; this spec fulfills the SIGNAL deferral.

## Self-review

- Placeholders: none.
- Internal consistency: rail list (9) + detail list (1) = 10, matches `routes.ts`'s SIGNAL block. `useShellData` swap count (9 files) verified via `grep -a` against actual imports (grep without `-a` silently under-counts on this repo — `signal-admin.tsx` is detected as binary by `file`/grep's heuristic despite being plain text).
- Scope: single module (SIGNAL), reuses 100% of ADR-0061's shared mechanisms, adds nothing new. No cross-link exception exists to preserve, unlike ORBIT's ADR-0054 — confirmed by grepping `lens.ts` for any `signal.`-specific branch (none found).
- Ambiguity: none — rail promotion order is not a judgment call (same `HIDDEN_ROUTES`-comment convention as AXIS/ORBIT). `signal/creatives/:id/image` is unambiguously a detail route, not a rail item — it renders no page at all.
