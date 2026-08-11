# ADR-0044 — Dependency major bumps taken before go-live, and the Expo SDK 57 deferral

- Status: accepted
- Date: 2026-08-11
- Supersedes: nothing
- Related: docs/25-go-live-checklist.md

## Context

Ten dependabot pull requests were open against `main` at the point the
go-live checklist otherwise cleared. Several were majors. Carrying an
unreviewed dependency backlog into production is worse than triaging it —
the first security advisory after launch forces the same upgrades under
time pressure, on a codebase nobody is watching.

Each bump was taken locally, verified against the full gate
(`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`) and pushed as its
own commit rather than merged from dependabot's branch, so a single commit
carries the dependency change and any source change it forces.

## Decision

**Taken:**

| Bump | Source change it forced |
| --- | --- |
| GitHub Actions majors (checkout v7, setup-node v7, pnpm/action-setup v6, codeql-action v4, gitleaks-action v3) | none; `pnpm/action-setup@v6` needs no `version` input because the root `package.json` pins `packageManager` |
| `@libsql/client` 0.14 → 0.17 | none |
| `wrangler` 3.99 → 4.120 (apps/api was still on v3) and `@cloudflare/workers-types` 4 → 5 | none; these move together because `@cloudflare/vite-plugin` 1.51 peer-requires wrangler ≥ 4.120.1, which peer-requires workers-types v5 |
| `vite` 7 → 8 (rolldown bundler) | the root `pnpm.overrides` entry for `vite` had to move from `>=6.4.3` to `>=8.2.1`; an override that is *below* a workspace's own spec makes `pnpm install --frozen-lockfile` fail in CI even when the lockfile is freshly written locally |
| `@hono/node-server` 1 → 2 | none; one call site, `apps/api/src/node.ts` |
| `zod` 3 → 4 | `z.record(x)` now reads its single argument as the *key* schema, so the four remaining one-argument call sites became `z.record(z.string(), x)` |
| `typescript` 5.9 → 6.0 | none in the workspace; see the exceptions below |
| `react` / `react-dom` 19.0 → 19.2.8, `@playwright/test` 1.49 → 1.62, `tsx`, `turbo`, `typescript-eslint`, `@cloudflare/vite-plugin` | none |

**Two exceptions inside the TypeScript bump:**

- `apps/mobile` stays on TypeScript `~5.9.2`. Expo 55's
  `@expo/require-utils` peer-requires `^5.0.0`, and the mobile app is the
  only workspace that runs through Expo's own tooling.
- TypeScript **7** is not taken. It typechecks the whole workspace cleanly,
  but `typescript-eslint` 8.67 refuses to load against it
  (`typescript-eslint does not support TS 7.0`), which takes `pnpm lint`
  down. Revisit when typescript-eslint ships TS 7 support.

**Deferred: Expo SDK 55 → 57.** Dependabot proposed `react-native`
0.83 → 0.86 (inside its "minor-and-patch" group, despite being neither),
plus `expo-router` 55 → 57, `expo-localization` 55 → 57 and
`expo-status-bar` 55 → 57. These are one upgrade, not four: Expo pins the
React Native version for an SDK, and the `expo-*` packages are versioned
against the SDK. Taking any of them alone produces a mobile app whose
native runtime and JS packages disagree.

An Expo SDK bump needs a native rebuild and a Detox run on real
simulators, which this repository's CI does not currently provide — the
mobile gate is unit tests plus Detox specs, not an EAS build. Doing it
under go-live pressure buys nothing: the web platform, which is what goes
live, does not depend on it.

## Consequences

- `main` carries current majors for everything the web and API stack ships,
  so the first post-launch advisory lands on a small diff.
- The mobile app sits one Expo SDK behind. It builds, typechecks and
  passes its tests on SDK 55; the debt is real but bounded and named.
- The TypeScript version is split across the workspace (6.0 everywhere,
  5.9 in `apps/mobile`). This is legible in the mobile `package.json` and
  disappears with the Expo bump.
- The Expo SDK 57 upgrade is a milestone of its own: bump `expo`,
  `react-native` and the `expo-*` packages together, run `expo-doctor`,
  rebuild native, and re-run Detox before merging.
