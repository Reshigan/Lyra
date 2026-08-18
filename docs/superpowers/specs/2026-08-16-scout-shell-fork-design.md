# Shell-per-module: SCOUT fork — design

**Status:** proposed
**Context:** ADR-0061 (shell-per-module, NORTH reference build), `docs/superpowers/specs/2026-08-16-axis-shell-fork-design.md`, `docs/superpowers/specs/2026-08-16-orbit-shell-fork-design.md`, `docs/superpowers/specs/2026-08-16-signal-shell-fork-design.md` (same pattern, first three instances), `apps/web/app/components/signal-shell.tsx`, `apps/web/app/routing.ts`, `docs/modules/scout.md`

## Why

ADR-0061 built the shared shell-per-module mechanism and deferred AXIS/ORBIT/SIGNAL/SCOUT. AXIS, ORBIT and SIGNAL's forks proved the pattern repeats cleanly. This spec is the addition for SCOUT, fourth and last of the four.

## Scope

**In scope:** `ScoutShell` component + `scout-shell.tsx` layout route, using every mechanism ADR-0061 already built, unchanged. No new shared machinery.

**Out of scope:** Any change to non-module shared screens. No ADR-0054-style cross-link exception exists for SCOUT — `lens.ts`'s only hard-coded cross-link is `orbit.retention` → `axis`; nothing references `scout`. Fixing `scout-whitespace.tsx`'s link into `/signal/studio` — already fixed on `main` (commit `ceae40d`, gated on `session.availableShells.includes("signal")`) ahead of this fork, so no regression to reintroduce here.

## Rail destinations

Read from `apps/web/app/routing.ts`'s `HIDDEN_ROUTES` comments — every path documented as linked from the SCOUT workspace tools list is a rail destination, same convention as AXIS/ORBIT/SIGNAL. Order follows `routes.ts`'s declaration order:

1. `scout/radar` — opportunity radar over clusters and whitespace
2. `scout/panel` — panel benchmarks and negotiation pack
3. `scout/pricing` — price position by line
4. `scout/experiments` — experiment board and decisions
5. `scout/analytics` — pricing elasticity and adequacy
6. `scout/data-products` — data-products subscriptions
7. `scout/admin` — admin settings
8. `scout/dev` — dev sandbox

**Not on the rail** (detail route opened from a list, same convention as `axis/policies/:id/detail` and `signal/creatives/:id/image`): `scout/whitespace/:id` — the dossier for one theme, opened from a dot on the radar. Unlike SIGNAL's detail route, this one **does** call `useShellData()` today (locale, permissions, domain pack for its labels and the move-state form) — so, deviating from SIGNAL's precedent, this route needs the same `useScoutSessionData()` swap as the eight rail routes, even though it isn't itself a rail item.

## Architecture (unchanged from ADR-0061 / AXIS+ORBIT+SIGNAL precedent)

- `scout-shell.tsx` layout route: calls `bootstrapSession()`, checks `session.availableShells.includes("scout")`, throws 403 if not, renders `<ScoutShell session={session}><Outlet /></ScoutShell>`. Copy of `signal-shell.tsx` with the module string swapped.
- `ScoutShell` component (`apps/web/app/components/scout-shell.tsx`): copy of `SignalShell`'s structure — own nav rail (8 destinations above), `--module-scout` accent (already defined in `packages/ui/src/tokens.css`, no new token needed), multi-role switcher when `availableShells.length > 1`, brand name/logo/colors from `session.brand`, header lockup pointing at `/scout/radar` (first rail destination, same convention as SIGNAL's `/signal/cockpit`). No Meridian.
- `routes.ts`: the existing `shouldInclude("scout") ? [...] : []` block (lines 66-77) moves from `layout("routes/workspace.tsx", [...])` to its own `layout("routes/scout-shell.tsx", [...])`. All 9 SCOUT routes (8 rail + 1 detail) move together.
- `useShellData` swap: **all 9** of the 9 route files call it today — `scout-radar.tsx`, `scout-whitespace.tsx`, `scout-panel.tsx`, `scout-pricing.tsx`, `scout-experiments.tsx`, `scout-analytics.tsx`, `scout-data-products.tsx`, `scout-admin.tsx`, `scout-dev.tsx` — switch to `useScoutSessionData()`. No file is exempt (unlike SIGNAL's `signal-creative-image.tsx`, which used no shell data at all).
- Roles resolving to `scout`: any `scout.*`-prefixed role, via the existing generic module-prefix rule in `lens.ts`/`routing.ts` (`role.split(".")[0]`) — no new special case, no ADR-0054-style exception.

## Testing (CLAUDE.md TDD, non-negotiable)

- Failing `@journey:J-SCOUT-SHELL` Playwright spec first: an actor with a `scout.*`-resolving role (`loginAsScoutLead`, already in `e2e/fixtures.ts` — `scout.lead` persona `tariq.mansour`) lands in `ScoutShell`, sees exactly the 8 rail destinations listed above, no Meridian, no other module's links.
- 403 (not 401) for an authenticated actor with no `scout.*`-resolving role hitting any `scout/*` path — port of AXIS/ORBIT/SIGNAL's `<module>-shell.test.ts` loader case (the real precedent; `shell.roles.test.ts` tests unrelated role-switcher logic, per SIGNAL's plan finding, which carries over here unchanged).
- Contract test extension: `LYRA_MODULES=scout` build's route manifest contains SCOUT routes and excludes north/axis/orbit/signal (extends the existing contract test).
- Unit test: `scout-shell.tsx` loader 403s when `availableShells` excludes `"scout"`.
- Regression: `scout-whitespace.tsx`'s existing `scout-whitespace.test.ts` (loader/action/helper tests, 17 cases) keeps passing after the `useScoutSessionData()` swap — this file's suite has no JSX render tests today (matches the file's existing convention, not a gap introduced by this fork), so the SIGNAL→link gate added in `ceae40d` is verified by typecheck + existing loader tests only, same as it is on `main` today.

## ADR

No new ADR. ADR-0061 already names the pattern; this spec fulfills the SCOUT deferral — the last of the four.

## Self-review

- Placeholders: none.
- Internal consistency: rail list (8) + detail list (1) = 9, matches `routes.ts`'s SCOUT block (lines 66-77, `radar, whitespace/:id, panel, pricing, experiments, analytics, data-products, admin, dev`). `useShellData` swap count (9 files, all of them) verified via `grep -rl "useShellData" apps/web/app/routes/scout-*.tsx`.
- Scope: single module (SCOUT), reuses 100% of ADR-0061's shared mechanisms, adds nothing new. No cross-link exception exists to preserve.
- Deviation from SIGNAL's plan noted: SIGNAL's detail route (`signal-creative-image.tsx`) needed no `useShellData` swap because it renders no chrome and reads no shell data. SCOUT's detail route (`scout-whitespace.tsx`) does read shell data (locale/permissions/domain pack) and does need the swap — so unlike SIGNAL's Task 4 ("9 of 10 files"), SCOUT's equivalent task is "9 of 9 files, no exemption." Flagging here so the plan doesn't copy SIGNAL's task text verbatim and silently drop `scout-whitespace.tsx`.
- Ambiguity: none — rail promotion order is not a judgment call (same `HIDDEN_ROUTES`-comment convention as AXIS/ORBIT/SIGNAL). `scout/whitespace/:id` is unambiguously a detail route, not a rail item (opened from a radar dot, not linked from the workspace tools list).
