# Shell-per-module: NORTH reference build — design

**Status:** proposed
**Context:** commit `212ef48` (unified all screens onto one shared `Shell`/`workspace.tsx` layout, 2026-08-13), ADR-0052 (no separate module switcher — the labelled rail is one), `packages/core/src/lens.ts` (`defaultWorkspaceForRoles`), `apps/web/app/routes.ts`, user-provided "Lyra Horizon" mockup (six-persona shell-per-role reference)

## Why

User asked why the real app doesn't match the pasted Horizon mockup's UI, which forks the shell entirely per role (exec/NORTH, ops/AXIS, cx/ORBIT, growth/SIGNAL, product/SCOUT, compliance) instead of one shared shell. Confirmed, after being shown that this reverses `212ef48`'s unification and touches ADR-0052's premise, that the literal six-shell fork is the intended direction. This spec covers the fork architecture plus a NORTH-only reference build to prove it before the other five modules follow.

## Relationship to existing decisions

- **Reverses `212ef48`'s single-shell direction for the five module prefixes** (north/axis/orbit/signal/scout). Non-module areas (ledger, admin, distribution, settings, platform, onboarding, design, search) are explicitly out of scope and keep today's shared `Shell` — `212ef48`'s unification stands for those.
- **Narrows ADR-0052**, does not reverse it. That ADR forbids mounting a second switcher widget beside a rail that already lists every destination the actor can reach — one shared rail, one list, no redundant second control. Under this design there is no longer one shared rail: each module shell has its own rail, scoped to only that module's own screens. The multi-role switcher introduced below (§5) is not a redundant second list over the same rail — it is the only way to reach a second, disjoint rail belonging to a different shell. ADR-0052's reasoning still holds within any one shell; it does not extend to choosing between shells. The implementing ADR must state this narrowing explicitly.

## Scope

**In scope (this spec):**
1. Shared session bootstrap extraction (`bootstrapSession()`)
2. `NorthShell` component + `north-shell.tsx` layout route
3. Meridian scrubber (live / replay / projection) on NORTH only
4. `LYRA_MODULES` build-time flag + standalone/together build mechanism
5. RBAC-scoped multi-role switcher (generic, not NORTH-specific — used by any shell)

**Out of scope (future specs, one per module, same pattern):** `AxisShell`, `OrbitShell`, `SignalShell`, `ScoutShell`, a compliance shell, and the mapping of non-module shared screens (ledger, distribution, admin/*, platform, settings) into whichever persona the mockup's SURF library assigns them to. Admin/QA impersonation-style shell preview is explicitly not built here.

## Architecture

### Shared bootstrap

`workspace.tsx`'s loader today does one job for every route beneath it: resolve the actor (`fetchMe`), branch on 401, load the inbox/day-strip data, batch-resolve approval subject names, and shape tenant brand/domain-pack/i18n/currency/calendar. This becomes `bootstrapSession(ctx, request): Promise<SessionBootstrap>` in `packages/core`, called identically by `workspace.tsx` (unchanged behavior for non-module areas) and by each new module layout. Tenancy, RBAC, and audit guarantees (CLAUDE.md rule 1) live in exactly one place regardless of how many shells exist.

`SessionBootstrap` adds one field beyond what `ShellData` has today: `availableShells: string[]` — every module workspace the actor's real roles resolve to (not just the first-wins default `defaultWorkspaceForRoles` returns today). Computed by iterating all of the actor's roles through the existing `WORKSPACE_BY_ROLE`/`WORKSPACE_BY_ROLE_PREFIX` tables in `lens.ts`, collecting every match instead of returning on the first.

### Routing

`routes.ts` moves the `north/*` block out of the single `layout("routes/workspace.tsx", [...])` into its own:

```ts
...(shouldInclude("north") ? [
  layout("routes/north-shell.tsx", [
    route("north/brief", "routes/north-brief.tsx"),
    route("north/explorer", "routes/north-explorer.tsx"),
    route("north/anomalies", "routes/north-anomalies.tsx"),
    route("north/whatif", "routes/north-whatif.tsx"),
    route("north/board", "routes/north-board.tsx"),
    route("north/board/:id/file", "routes/north-board-file.tsx"),
    route("north/decisions", "routes/north-decisions.tsx"),
    route("north/admin", "routes/north-admin.tsx"),
    route("north/dev", "routes/north-dev.tsx")
  ])
] : []),
```

`shouldInclude(module)` reads `process.env.LYRA_MODULES` once at config-eval time (comma-separated list, e.g. `"north"` or `"north,axis"`; unset or `"all"` includes everything — today's behavior, zero change for the default build). `login`/`logout` are always included regardless of flag — no module can be standalone without auth.

`north-shell.tsx`:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const session = await bootstrapSession(context.get(cloudflare).env, request);
  // 403, not 401 — the actor is real, just not entitled to this shell.
  if (!session.availableShells.includes("north")) throw data("", { status: 403 });
  return session;
}

export default function NorthShellLayout() {
  const session = useLoaderData<typeof loader>();
  return (
    <NorthShell session={session}>
      <Outlet />
    </NorthShell>
  );
}
```

The same 403-on-missing-shell check is the pattern every future module layout repeats — it is what `shell.roles.test.ts` verifies today for the single shell, ported to per-shell form.

### `NorthShell`

New component, `apps/web/app/components/north-shell.tsx`. Owns: its own nav rail (the nine `north/*` destinations only, no other module's items), the `--north` purple accent already defined in `packages/ui` tokens, Instrument Serif headline treatment for the answer-bar pattern (already established convention — reused, not reinvented), and the multi-role switcher (§5) when `availableShells.length > 1`. Brand name/logo/colors still read from `session.brand` — CLAUDE.md rule 5 applies identically inside a forked shell.

### Meridian

`apps/web/app/components/meridian.tsx`. Three states, driven entirely by URL search params (no client-only scrub state — consistent with every other loader-driven surface in the app):

- **live** — no param, current behavior.
- **replay** — `?asOf=<epoch-ms>`. Follows the existing as-of convention already in `ledger-money-map.tsx` (`asOf: number`). `north-brief.tsx`, `north-explorer.tsx`, and `north-anomalies.tsx` loaders gain an optional `asOf`, threaded into their existing queries as an upper time bound. No new snapshot table — this replays real historical rows through queries that already exist, just parameterized.
- **projection** — `?scenario=<id>`. Reuses `north-whatif.tsx`'s existing scenario engine unchanged (assumptions, saved library, confidence bands already built there). Meridian's forward half renders that scenario's projected series on the timeline instead of requiring a trip to a separate screen.

The scrubber drags between the three; dragging left of "now" sets `asOf`, right of "now" opens the scenario picker and sets `scenario`.

### Standalone / together build

`LYRA_MODULES` is a build-time env var (read by `routes.ts` during `vite build`/dev config eval), unrelated to `wrangler.jsonc`'s runtime `vars` block — those affect the deployed Worker's behavior, not what gets bundled into it. `wrangler.jsonc` gets no new `env` block in this spec; a standalone NORTH Worker (own name, own route/subdomain, built via `LYRA_MODULES=north pnpm build`) is added when a real deploy target needs one. The `shouldInclude()` seam ships now regardless (CLAUDE.md rule 15) — a contract test proves a `LYRA_MODULES=north` build's route manifest contains zero AXIS/ORBIT/SIGNAL/SCOUT routes, so the seam can't silently rot before it has a second consumer.

### Multi-role switcher

Renders only when `session.availableShells.length > 1`. Not a duplicate of any one shell's rail (ADR-0052 still governs within a shell) — it is the control that crosses shells, shown once, in whichever shell the actor is currently in, listing only the shells their real roles actually resolve to. A `north.exec`-only actor never sees it.

## Testing (CLAUDE.md TDD, non-negotiable)

- Failing `@journey:J-XX` Playwright spec first: an actor with `north.exec` lands in `NorthShell`, sees only NORTH's nine destinations, Meridian defaults to live.
- Unit tests for `bootstrapSession()` extraction — `shell.roles.test.ts` and `shell.brand.test.ts` behavior must still pass unchanged against the extracted function (moved/adapted, not dropped).
- Unit tests for `availableShells` resolution (multi-role actor gets every match, single-role actor gets exactly one).
- Loader tests: `asOf` on `north-brief`/`north-explorer`/`north-anomalies` returns rows as of that timestamp, defaults to live when absent.
- Contract test: `LYRA_MODULES=north` build's route manifest excludes every other module's routes.
- 403 (not 401) for an authenticated actor with no `north.*`-resolving role hitting any `north/*` path.

## ADR

`docs/decisions/ADR-0061-shell-per-module.md`, written before the first `NorthShell` commit. Must state: the fork decision and its scope (five module prefixes only, non-module areas unaffected), the shared-bootstrap boundary that keeps tenancy/RBAC/audit centralized, the `LYRA_MODULES` seam, and the explicit narrowing of ADR-0052 described above.

## Self-review

- Placeholders: none.
- Internal consistency: standalone-build mechanism (§ Standalone/together build) and the routing section's `shouldInclude()` agree on shape; Meridian's `asOf` matches `ledger-money-map.tsx`'s existing field type.
- Scope: single spec, one module (NORTH) as reference plus the cross-cutting mechanisms (bootstrap, module flag, switcher) the other five will reuse without re-deriving. AXIS/ORBIT/SIGNAL/SCOUT/compliance are explicitly follow-on specs, not tasks here.
- Ambiguity: non-module shared-screen mapping (ledger, admin, distribution, etc.) is deferred to those follow-on specs by explicit user decision ("exactly like the design" — mapped per the mockup's own SURF-library assignment, not decided here).
