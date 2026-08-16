# Shell-per-module: AXIS fork — design

**Status:** proposed
**Context:** ADR-0061 (shell-per-module, NORTH reference build), `docs/superpowers/specs/2026-08-15-north-shell-fork-design.md`, `apps/web/app/components/north-shell.tsx`, `apps/web/app/session.server.ts`, `apps/web/app/routing.ts`

## Why

ADR-0061 built NORTH's shell plus every shared mechanism (`bootstrapSession()`, `availableShellsForRoles`, `LYRA_MODULES`/`shouldInclude()`, `ModuleSwitcher`/`ModuleLink`) and explicitly deferred AXIS/ORBIT/SIGNAL/SCOUT to follow-on specs, "one addition: one layout route + one shell component + one `shouldInclude()` entry — the seam is proven, not theoretical." This spec is that addition for AXIS, first of the four (user's choice, four separate specs, AXIS first).

## Scope

**In scope:** `AxisShell` component + `axis-shell.tsx` layout route, using every mechanism ADR-0061 already built, unchanged. No new shared machinery.

**Out of scope:** ORBIT/SIGNAL/SCOUT (separate specs, same pattern). Meridian — ADR-0061 is explicit that Meridian is NORTH-only (`/north/whatif` is a rail destination, not a scrubber mode); AXIS gets no scrubber. Any change to non-module shared screens (ledger, admin, distribution, settings) — still out of scope per ADR-0061.

## Rail destinations

Read from `apps/web/app/routing.ts`'s existing `HIDDEN_ROUTES` comments — every path already documented as "linked from the AXIS workspace tools list" is a rail destination today (surfaced via a tools list inside the shared `Shell`'s `/axis` workspace page); this spec promotes exactly that set onto `AxisShell`'s own rail, same set NORTH's fork promoted from its own tools list. Order follows `routes.ts`'s declaration order:

1. `axis/exceptions` — cross-resource work queue
2. `axis/board` — production board of cases by state
3. `axis/quote-desk` — quote desk and group bids
4. `axis/doc-intelligence` — extraction review over documents
5. `axis/analytics` — operations analytics and exports
6. `axis/process-map` — case-state flow diagram
7. `axis/renewals` — renewal desk
8. `axis/referrals` — underwriting referral desk
9. `axis/claims/desk` — claims handling desk
10. `axis/admin` — SOP publish, connector health, operating policy
11. `axis/dev` — extraction sandbox

**Not on the rail** (detail/action routes opened from a list or another rail page, same convention as `north/board/:id/file`): `axis/documents/:id/file`, `axis/cases/:id/evidence-bundles/:bundleId/download`, `axis/policies/:id/detail`, `axis/policies/:id/endorse`, `axis/policies/:id/cancel`, `axis/claims/new`, `axis/claims/:id/detail`, `axis/cases/:id/detail`. These move under `axis-shell.tsx`'s layout (same shell chrome) but are not rail items, exactly as `north/board/:id/file` isn't.

## Architecture (unchanged from ADR-0061)

- `axis-shell.tsx` layout route: calls `bootstrapSession()`, checks `session.availableShells.includes("axis")`, throws 403 if not, renders `<AxisShell session={session}><Outlet /></AxisShell>`. Copy of `north-shell.tsx` with the module string swapped.
- `AxisShell` component (`apps/web/app/components/axis-shell.tsx`): copy of `NorthShell`'s structure — own nav rail (11 destinations above), `--module-axis` accent (already defined in `packages/ui/src/tokens.css:204`, no new token needed), multi-role switcher when `availableShells.length > 1`, brand name/logo/colors from `session.brand`. No Meridian.
- `routes.ts`: the existing `shouldInclude("axis") ? [...] : []` block (lines 95-119) moves from `layout("routes/workspace.tsx", [...])` to its own `layout("routes/axis-shell.tsx", [...])`, same as NORTH's block did. All 19 AXIS routes (11 rail + 8 detail) move together — they all get the new shell chrome, only the 11 are on the rail.
- Every route file among the 19 that currently reads `useShellData()` switches to `useAxisSessionData()` (or whatever the loader returns — same pattern as NORTH's task 9, "swap `useShellData` to `useNorthSessionData` in 8 north routes").

## Testing (CLAUDE.md TDD, non-negotiable)

- Failing `@journey:J-XX` Playwright spec first: an actor with an `axis.*`-resolving role lands in `AxisShell`, sees exactly the 11 rail destinations listed above, no Meridian.
- 403 (not 401) for an authenticated actor with no `axis.*`-resolving role hitting any `axis/*` path — port of `shell.roles.test.ts`'s NORTH case.
- Contract test extension: `LYRA_MODULES=axis` build's route manifest contains AXIS routes and excludes north/orbit/signal/scout (extends the existing `LYRA_MODULES=north` contract test in `apps/web/app/routes.test.ts`).
- Unit test: `axis-shell.tsx` loader 403s when `availableShells` excludes `"axis"`.

## ADR

No new ADR. ADR-0061 already states the pattern and names `AxisShell` as deferred-not-reversed; this spec fulfills that deferral. The ADR's "Consequences" section already predicted this exact addition shape.

## Self-review

- Placeholders: none.
- Internal consistency: rail list and route-move list both come from the same `routing.ts` read; the 11-vs-19 split matches the same rail/detail distinction NORTH's fork used.
- Scope: single module (AXIS), reuses 100% of ADR-0061's shared mechanisms, adds nothing new to them.
- Ambiguity: none — every rail item is already labelled "linked from the AXIS workspace tools list" in existing code, so promotion order is not a judgment call.
