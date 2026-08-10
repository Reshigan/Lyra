# Mobile Foundation Shell — Design

Status: approved. Phase 0 of native mobile-parity build (docs/08). Sub-project
1 of N; each per-role phase and the separate PWA installability sub-project
get their own spec later.

## Problem

`apps/mobile` has production-grade auth/session/theming infra but only a
generic, explicitly-provisional content layer: one flat permission-gated nav
list (`src/nav.ts`), one `ModuleList`/`ModuleDetail` screen pair reused for
every resource (`app/m/[nav]/index.tsx`, `app/m/[nav]/[id].tsx` — the latter's
own comment says a per-resource layout is "a design decision made in the
wrong phase"). docs/08 specs a role-adaptive shell (max 4 tabs + More per
role) with 5 signature experiences. The web app already has all 23 docs/06
journeys built; mobile has none of the per-role UX. User decision: build full
native parity, organized per role, not deferred, not a subset. Also build a
PWA installability layer on top of the existing complete web app (separate
spec). This spec covers only the native app's foundation shell — the
structural layer every later per-role phase builds screens into.

## Non-goals for this phase

- Real per-role journey screens (Approvals Center, 7am Brief, Doc capture,
  Agent pocket console, Live tiles) — later phases, one spec each.
- Offline outbox, push notifications, VisionCamera doc-scan — later phases.
- Detox e2e spec updates for new screens — done alongside the phase that adds
  the screens they cover.
- PWA installability layer — separate, smaller sub-project spec.

## Role → persona resolution

Reuse `defaultWorkspaceForRoles(roles: readonly string[]): string` from
`packages/core/src/lens.ts` verbatim (already exported, already the
mechanism `resolveLens` uses to pick a user's default web workspace). Do not
reimplement role-precedence logic on the client — the web lens and the
mobile persona must agree, and the function already encodes the tenant's
canonical precedence table (`WORKSPACE_BY_ROLE`, `WORKSPACE_BY_ROLE_PREFIX`,
prefix fallback, `"north"` when roleless).

`apps/mobile/src/api.ts`'s `Me` already carries `roles: string[]`
(confirmed, `Me.roles` at api.ts:163). Call
`defaultWorkspaceForRoles(me.roles)` once per session bootstrap (alongside
the existing `/v1/me` fetch in `session.tsx`), store the resolved workspace
string on `Session`, and treat it as fixed for the session's lifetime (same
staleness contract as the web lens: a stored lens always wins, and resolution
does not silently self-correct mid-session).

Resolves to one of: `axis | orbit | signal | scout | north | admin |
distribution | ledger | compliance | settings`.

## Persona → tabs

New file `apps/mobile/src/personas.ts` exporting a static
`Record<Workspace, TabConfig[]>` (`TabConfig = { labelKey: string; icon:
string; screen: string }`), max 4 entries + an always-present "More" tab
(docs/08's ceiling). One entry per resolved workspace:

| Workspace | Tabs (docs/08 role) |
|---|---|
| `axis` | Queue, SLA, Cases, More (Ops) |
| `orbit` | Inbox, Renewals, Approvals, More (CX agent) |
| `signal` | Campaigns, Budget, Attribution, More (Marketer) |
| `scout` | Clusters, Whitespace, Panel, More (Product) |
| `north` | Brief, Decisions, Boardpack, More (Exec; `north.board` sub-role swaps Decisions for Governance — same tab slot, resolved by exact role match before the workspace-level default, mirroring `WORKSPACE_BY_ROLE`'s exact-role-wins precedence) |
| `admin` | Approvals, Staff, Settings, More (Tenant admin; also serves `platform.*`/`dev.*` staff roles per the existing prefix mapping) |
| `distribution`, `ledger`, `compliance`, `settings` | Home, More only |

The last row covers personas docs/08 does not spec bespoke UX for (partner
devs, finance, compliance officers, customers). Building one now would be
inventing scope the spec doesn't ask for.

## Interim tab content

Every tab renders the existing `ModuleList`/`ModuleDetail` pair
(`app/m/[nav]/index.tsx`, `[id].tsx`, unmodified) scoped to that tab's primary
resource, until the owning per-role phase replaces it with a real journey
screen. This is not new code — it's the current-and-only screen, now reached
through a role-shaped tab bar instead of a flat nav list. Nothing regresses.

## Styling

No new dependency. Keep `apps/mobile/src/theme.ts` (StyleSheet + `Theme`
interface, already mirrors `packages/ui/src/tokens.css`, already
tenant-brand-aware via `themeFor(brand)`, already WCAG-compliant
`TOUCH_TARGET = 44`, already the pattern `login.tsx` uses throughout).
docs/08 mentions NativeWind but the actual requirement — same token set as
web — is already met. Adding NativeWind would be a second styling system for
zero new capability. Boring technology; novelty needs an ADR (CLAUDE.md
guardrails).

## Biometric gate

New `apps/mobile/src/biometric-gate.tsx`: wraps `session.tsx`'s
`status === "signedIn"` render branch. On cold start and on foreground
resume, calls `expo-local-authentication` (new dependency — first of docs/08's
signature-experience libraries to land) to require Face/Touch ID, falling
back to device passcode. If the device has no biometric/passcode enrolled,
skip the gate rather than lock the user out — never silently bypass when an
enrolled method exists. This sits strictly above the existing
password/TOTP-MFA state machine in `session.tsx` (`Status = "loading" |
"signedOut" | "mfa" | "signedIn"`) and does not modify it.

## File changes

- New: `apps/mobile/src/personas.ts` (persona → tabs config table)
- New: `apps/mobile/src/biometric-gate.tsx` (biometric wrapper component)
- Modify: `apps/mobile/src/session.tsx` (resolve + store persona workspace on
  bootstrap, alongside existing `/v1/me` fetch)
- Modify: `apps/mobile/app/m/` layout (add Expo Router tab navigator driven by
  `personas.ts`, replacing the current flat nav-list entry point; `[nav]` /
  `[id].tsx` screens unchanged, now reached via tabs)
- Modify: `apps/mobile/package.json` (add `expo-local-authentication`)
- Modify: `apps/mobile/package.json` devDependencies → dependencies for
  `@lyra/core` (currently a devDependency; `defaultWorkspaceForRoles` is a
  runtime import, not test-only)

## Testing

- Unit: `personas.ts` table shape (every workspace key present, ≤4 tabs +
  More each); persona resolution delegates to `defaultWorkspaceForRoles`
  (no reimplemented precedence logic to test independently).
- Unit: `biometric-gate.tsx` — renders children when no biometric enrolled;
  blocks + prompts when enrolled; re-prompts on foreground resume.
- Detox: extend `apps/mobile/e2e/02-list-detail.e2e.ts` (or a new spec) to
  confirm tab bar renders correct tab count/labels for a seeded `north.exec`
  session and an `axis.agent` session — the two roles already used by
  existing fixtures/tests elsewhere in the suite.

## Self-review

- Placeholders: none — every section has concrete values (exact function
  name, exact file paths, exact tab labels, exact dependency name).
- Consistency: persona list matches rbac.ts's canonical role catalog
  (verified directly, not via Stryker sandbox); tab ceiling matches docs/08's
  "max 4 + More."
- Scope: single cohesive deliverable (shell + gate + styling decision), no
  journey content — correctly split from the 7 per-role phases.
- Ambiguity: `north.board` tab-swap behavior made explicit (exact-role
  precedence, mirroring `WORKSPACE_BY_ROLE`) rather than left to the
  implementer to guess.
