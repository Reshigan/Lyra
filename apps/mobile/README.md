# @lyra/mobile

Expo (SDK 55) + expo-router client for the LYRA API. Managed workflow, iOS and
Android. It is a thin, honest client: it signs in, reads `/v1/me`, and browses
whatever the API says this actor may see. It is not a port of the web app.

## Run it

```bash
pnpm i
pnpm --filter @lyra/mobile start        # Expo dev server; press i / a
pnpm --filter @lyra/mobile typecheck
pnpm --filter @lyra/mobile test
```

API base URL comes from `EXPO_PUBLIC_API_URL`, defaulting to
`https://api.lyra.vantax.co.za`. Point it at a local worker with:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter @lyra/mobile start
```

There are no secrets in this app and there must never be: everything in an
`EXPO_PUBLIC_*` var ships inside the bundle and is readable by anyone who has
the binary.

## What actually works

- **Sign in.** `POST /v1/auth/login` with email + password. The workspace
  (`tenantSlug`) field only appears when the API says the email is ambiguous.
  The returned `token` is stored in `expo-secure-store`
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, one key) and sent as
  `Authorization: Bearer` on every later call.
- **Two-step verification.** The full flow, mirroring
  `apps/web/app/routes/login.tsx`: password → *verify* (enter the code from an
  authenticator, or a recovery code) or *enrol* (`POST /v1/auth/mfa/enrol`
  shows the setup key as selectable text plus an "open in authenticator" link,
  then `…/enrol/confirm` returns the recovery codes, shown once) → app. Which
  screen is drawn comes from the API — `mfaStep` on the login response, or the
  `step` on the 403 a restored session gets — never from a guess here.
- **Session restore.** On launch the stored token is read and `/v1/me` is
  called. A dead network does *not* wipe the session; only a 401, or a 403 that
  is not `mfa_required`, does. A session that exists but has not cleared its
  second factor lands on the right MFA screen instead of being signed out.
- **Home.** Rendered entirely from the `nav` array in `/v1/me`. No menu is
  hard-coded. Every item shows a visible text label — never an icon alone.
  Brand name, logo and accent colours come from `tenant.brand`; there is no
  literal product name anywhere in a user-facing surface.
- **List.** `GET /v1/{module}/{resource}?limit=50` for the tapped nav item,
  rendered generically (best-guess title/subtitle field per row).
- **Detail.** `GET /v1/{module}/{resource}/{id}`, rendered as every field of
  the record, key and value, in payload order.
- **Sign out.** `POST /v1/auth/logout` (revokes server-side), then the local
  key is deleted.
- **Locale and direction.** `en` and `ar` catalogues, locale from `/v1/me`
  falling back to the device. `ar` sets `I18nManager` RTL and every screen uses
  logical (start/end) edges and `writingDirection`.
- **Accessibility.** 44pt minimum touch targets, `accessibilityRole`/`Label`/
  `State` on every interactive element, errors announced as live-region alerts,
  Deep Field palette contrast ≥ 4.5:1 for body text.

## What does not work / is deliberately absent

- **No QR code at enrolment.** The setup key is shown as selectable text and an
  `otpauth://` link, the same as the web shell. A QR needs an encoder
  dependency; the link handles the same-device case, which is the mobile one.
- **No way to turn the second factor off.** `POST /v1/auth/mfa/disable` exists
  and this app never calls it — there is no settings screen. Staff cannot
  disable it in any client anyway.
- **The code field shows a number pad.** A recovery code (`XXXX-XXXX`) has to
  be pasted rather than typed on the verify screen.
- **No per-resource UI.** A case, a campaign and a ledger transaction all
  render as the same generic list row and the same key/value detail sheet. No
  domain-pack vocabulary is applied to *field names* yet (nav labels are
  translated; field keys are shown raw).
- **No writes.** Read-only. No create, edit, approve, or delete — which also
  means no transaction, idempotency-key, or approval flow lives here.
- **No AI surfaces.** None of docs/15's ambient patterns (ghost text, chips,
  background drafts, the ✦ marker) are implemented.
- **No pagination.** First 50 rows only. The API's `cursor` is parsed and
  ignored; there is no infinite scroll and no pull-to-refresh.
- **No offline.** No cache, no outbox, no optimistic writes. Every screen is a
  live fetch; no network means an error and a retry button.
- **No push notifications, no deep links** beyond the `lyra://` scheme being
  declared, **no biometrics**, **no camera/document capture**, **no maps**,
  **no tabs** (a single stack), **no web target**.
- **No tenant switcher.** The session is whatever tenant the login resolved.
- **Nav items the app cannot open** (an href with no known resource) render
  dimmed and labelled "Not on mobile yet" rather than being hidden — hiding
  them would make a permission look like a bug.
- **`app.json` `name`/`slug` say "Lyra".** That is build-time app-store
  identity, not a user-facing brand string; a white-label build changes it at
  build time.

## Tests

`src/mobile.test.ts` — vitest, node environment, `expo-secure-store` mocked.
Covers the token store (round-trip, single key, device-only keychain option,
unreadable keystore reads as signed-out), the nav-href → route/resource mapping
(including that every href `apps/api/src/routes/me.ts` can return has a label
key both catalogues translate), generic row title/subtitle/field derivation, the
sign-in step machine (which screen a login response and a 403 `mfa_required`
each land on), and i18n + brand-token resolution.

**Nothing renders in the tests.** There is no component test: that needs
`jest-expo` and a React Native transform, which is a second test runner in the
monorepo. Add it when there is component logic worth asserting — right now the
screens are mostly layout over the tested helpers.
