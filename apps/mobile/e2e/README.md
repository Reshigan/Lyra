# Mobile e2e (Detox)

Covers the app as it exists today (README: sign-in, generic list/detail,
sign-out — no offline/cache/outbox, no push/deep-links, no biometrics, no
camera/doc-capture). docs/08-mobile.md §3/§7's "five signature flows" (Brief,
Approvals, Doc capture, Agent console, Live tiles) describe the M6 future
vision, not this build — noted here rather than silently building against
the wrong doc. The five flows below are the current-app equivalent: every
screen the README says works, once each.

1. `01-sign-in-enrol` — password sign-in, tenant-slug field, MFA enrolment
   (reads the setup key via `testID="enrol-secret"`, since Detox has no
   regex text matcher), TOTP confirm, recovery codes, lands on Home.
2. `02-list-detail` — Home → list → detail → back, generic row rendering.
3. `03-sign-out` — sign-out clears the session; a new app instance (no
   delete) still lands on Login, proving the token is really gone.
4. `04-returning-sign-in` — a second password sign-in hits the TOTP screen,
   not enrolment, proving the server remembers the persona from (1).
5. `05-locale-rtl` — device locale `ar` renders the Arabic login copy
   (the one screen reachable with no session, so no sign-in needed first).

## Ordering

Files run in numeric order (jest's alphabetical `testMatch` + this suite's
`maxWorkers: 1`) and share one persona (`tenant.admin`, the only seeded role
with `core:*:*`) across (1)-(4) via `device.reloadReactNative()`, which keeps
the expo-secure-store session token alive between files. (1) writes the
TOTP secret to a scratch JSON file (`secret-cache.ts`); (4) reads it back.
Don't reorder or delete files — (2)-(4) depend on (1) having run first in
the same suite.

## Before `detox test`

Debug builds load JS live from Metro, not an embedded bundle, so both the
API and the packager must already be running against this suite's own DB
before Detox drives the app:

```sh
pnpm e2e:setup                 # migrate + seed apps/mobile/e2e's own sqlite file

# terminal 1 — LIBSQL_URL/PORT must match apps/mobile/e2e/env.ts's
# LIBSQL_URL/API_PORT exactly (path is node:os tmpdir() + "lyra-mobile-e2e")
LIBSQL_URL="file://$(node -e 'console.log(require("node:os").tmpdir())')/lyra-mobile-e2e/e2e.db" \
  PORT=8788 pnpm --filter @lyra/api start

# terminal 2
EXPO_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter @lyra/mobile start

# terminal 3
pnpm --filter @lyra/mobile e2e:prebuild
pnpm --filter @lyra/mobile e2e:build:ios   # or :android
pnpm --filter @lyra/mobile e2e:test:ios    # or :android
```

`pnpm --filter @lyra/mobile e2e` only runs `e2e:setup` + `e2e:test:ios` — it
assumes the API, Metro, and the built app binary are already up per above.

## Dev-only app.json changes

`app.json` gained `ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking`
and `android.usesCleartextTraffic` so Debug builds can reach the local API
over plain HTTP. `NSAllowsLocalNetworking` is scoped to LAN traffic and fine
to leave. `usesCleartextTraffic: true` is a blanket Android relaxation —
scope it to a network-security-config allowing only `127.0.0.1`/`10.0.2.2`,
or drop it, before any real production build config exists.

## Out of scope (and why)

- Offline/cache/outbox, push/deep-links, biometrics, camera/doc-capture —
  README says none exist yet; nothing to test.
- Real EAS/device builds — credential-gated, and the task only needed
  simulator/emulator coverage.
- `jest-expo` — unneeded; Detox specs run as plain Node/Jest driving a
  compiled binary, not RN-rendering tests.
- `@config-plugins/detox` — peer range wants `expo@^53`, repo is on 55;
  hand-written `app.json` entries above do the same job in two lines.
- CI wiring — `.github/workflows/ci.yml` has no macOS/Android runner today;
  these specs are scaffolded ahead of that, not wired in.
