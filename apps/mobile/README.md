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
  logical (start/end) edges. Every piece of text goes through `textOf()`
  (`src/ui.tsx`), which sets `writingDirection` *and* an explicit `textAlign` —
  natural alignment follows `I18nManager.isRTL`, which only flips on the next
  launch, so without it the first Arabic session renders left-aligned.
- **Accessibility.** 44pt minimum touch targets, `accessibilityRole`/`Label`/
  `State` on every interactive element, errors announced as live-region alerts,
  Deep Field palette contrast ≥ 4.5:1 for body text. The stack draws no native
  header, so the list and detail screens carry their own **Back** control: an
  edge swipe is not something a screen-reader or switch-control user can perform.
- **Brand.** Name, logo, the three accent tokens (`accent`, `accentHover`,
  `accentContrast`) and the typeface all come from `tenant.brand` — see
  *Typeface* below for what the typeface can and cannot do on a device.

## Typeface

`brand.font` is validated against the same three approved values `BrandJson`
allows (`packages/db/src/json.ts`) and the same set the web shell maps to
`--font-display`/`--font-ui` (`apps/web/app/components/shell.tsx`). The lookup
is `src/theme.ts` `fontFamilyFor` — a `Map`, not an object literal, so a
tenant-supplied `__proto__` or `constructor` resolves to nothing rather than to
something inherited. Anything off the list falls back to the platform typeface.
The resolved family is applied to every `Text` and `TextInput` through
`textOf()`.

**What this does not do on a stock build:** nothing here *registers* those
families. React Native's `fontFamily` is one registered family name — there is
no font stack, no `system-ui` fallback, no `@font-face`. This repo ships no font
assets, and `expo-font` is not a dependency of this package, so on a build made
from this repo all three approved values resolve to the platform typeface (San
Francisco / Roboto), which is the same as choosing none. It does not fail, and
Arabic still renders, because the platform typeface has Arabic coverage.

The mapping is the seam, not decoration: making a tenant's saved typeface
actually render needs three things this repo does not have — the `.ttf` files
committed as assets, `expo-font` added as a direct dependency, and an
`["expo-font", { fonts: [...] }]` entry in `app.json` so the family is
registered natively at build time. Add those in a white-label build and the
tenant's choice starts rendering with no change to this code.

(The web shell no longer has the mirror-image gap: `packages/ui/src/tokens.css`
declares `@font-face` for all four families and `apps/web/public/fonts/` ships
the woff2 files — see `packages/ui/FONTS.md`. Those files are **woff2 only** and
subsetted, so they are not usable here: React Native loads `.ttf`/`.otf`, and
the Latin cuts carry no Arabic coverage.)

## What does not work / is deliberately absent

- **No QR code at enrolment.** The setup key is shown as selectable text and an
  `otpauth://` link, the same as the web shell. A QR needs an encoder
  dependency; the link handles the same-device case, which is the mobile one.
- **No way to turn the second factor off.** `POST /v1/auth/mfa/disable` exists
  and this app never calls it — there is no settings screen. Staff cannot
  disable it in any client anyway.
- **The code field shows a number pad.** A recovery code (`XXXX-XXXX`) has to
  be pasted rather than typed on the verify screen.
- **No per-resource *detail* UI.** The journey screens (`app/j/*`) are
  per-purpose lists, but every record still opens the one generic key/value
  sheet (`app/m/[nav]/[id].tsx`): a case, a campaign and a ledger transaction
  are all rendered as their fields in payload order. No domain-pack vocabulary
  is applied to *field names* yet (nav labels are translated; field keys are
  shown raw).
- **Almost no writes.** The only ones are the ones a phone is actually for:
  deciding an approval, replying on a thread, uploading a captured document,
  asking for today's briefing. No create, edit or delete, and no state machine,
  idempotency key or approval flow is implemented here — every one of those
  belongs to the endpoint, and this app only reports what came back.
- **No AI surfaces.** None of docs/15's ambient patterns (ghost text, chips,
  background drafts, the ✦ marker) are implemented.
- **No pagination.** First 50 rows only. The API's `cursor` is parsed and
  ignored; there is no infinite scroll and no pull-to-refresh.
- **No offline.** No cache, no outbox, no optimistic writes. Every screen is a
  live fetch; no network means an error and a retry button — including at
  launch: a stored session that cannot reach `/v1/me` keeps its token and shows
  the reason plus a retry on the sign-in screen, rather than presenting a bare
  password form to someone who is merely offline.
- **No custom fonts bundled.** See *Typeface* above.
- **No push notifications, no deep links** beyond the `lyra://` scheme being
  declared, **no maps**, **no web target**. (Biometrics, the document camera
  and a tab bar have since landed — `src/biometric-gate.tsx`,
  `app/j/capture.tsx`, `app/(tabs)/`.)
- **No tenant switcher.** The session is whatever tenant the login resolved.
- **Nav items the app cannot open** (an href with no known resource) render
  dimmed and labelled "Not on mobile yet" rather than being hidden — hiding
  them would make a permission look like a bug.
- **`app.json` `name`/`slug` say "Lyra".** That is build-time app-store
  identity, not a user-facing brand string; a white-label build changes it at
  build time.

## Web surfaces with no mobile counterpart

CLAUDE.md's definition of done asks for mobile parity to be *noted*, not always
built. These are the web surfaces deliberately not mirrored here, with what it
would take to mirror them — so the next person reads a decision rather than an
oversight.

- **Process flows — `StateFlow` / `PostingFlow` (`packages/ui/src/flow.tsx`),
  drawn by `ledger-transaction`, `settlement-detail`, `claim-detail`,
  `case-detail` and `policy-detail`.** Not mirrored, and not mirrorable without
  moving code that is not ours to move. `flowPlan` is the doctrine: it decides
  what *done*, *now* and *pending* mean, and refuses a spine whose steps are not
  documented edges of the machine. A copy of it on this side would be a second
  opinion about the state machine, which is worse than drawing nothing — and it
  cannot be imported as things stand, because `@lyra/ui` is not a dependency of
  this package and its only export is the barrel, which drags `radix-ui` and
  `react-dom` into a Metro bundle (the same wall `src/names.ts` hit, and why it
  restates `shortRef` rather than importing it). The machines the planner needs
  (`TXN_FLOW`, `CLAIM_FLOW`, `CASE_FLOW`, `POLICY_FLOW`) are literals in
  `apps/web/app/routes/`, which is an app and not a package, so copying *those*
  would just move the drift from the planner to the machine. `PostingFlow` has a
  third problem on top: its verdict is `balanceCheck`
  (`apps/web/app/routes/ledger.shared.ts`), computed on the server for the web,
  and this app must never re-add money on the client — the API exposes no
  balance verdict to read instead. **Unblocked by:** a `./flow` subpath export on
  `@lyra/ui` (or `flowPlan` moved to `@lyra/core`, which is already a dependency
  here), the machines moved beside it, and a balance verdict on the transaction
  read. Note also that nothing in this suite can render a React Native component
  (see *Tests*), so a flow view would ship untested until that changes. Until
  then a transaction opens the generic detail sheet: the transitions the API
  returned, as rows — history, with no claim about what is still owed.
- **Hero drill-down (`apps/web/app/components/hero.tsx`).** A headline figure
  that opens exactly the rows it counted, through one predicate over one array
  (`lensOf`), addressed by `?focus=`. Not mirrored. `lensOf` would port cleanly;
  the surface it exists for does not. There is no KPI wall here, and the journey
  screens already *open* on the narrowed set — `app/j/money.tsx` lists money that
  has not landed, rather than a total someone has to drill into. Port it when a
  mobile screen first shows a figure standing for rows it does not already list.
- **SCOUT whitespace commentary
  (`apps/web/app/components/whitespace-commentary.tsx`).** The reader's stance,
  confidence and note on one whitespace, as a ghost card on the radar and a chip
  in the dossier. Not mirrored, and not designed for here yet: its web contract
  is mid-rewrite, and this app has no ambient-AI surface at all (see *No AI
  surfaces*) to carry the ✦ marker and its inspectable "why". `app/j/whitespace.tsx`
  ranks the same cells by the two numbers the web radar plots and says nothing
  the reader wrote — an omission, not a summary of one.

## Tests

`src/mobile.test.ts` — vitest, node environment, `expo-secure-store` mocked.
Covers the token store (round-trip, single key, device-only keychain option,
unreadable keystore reads as signed-out), the nav-href → route/resource mapping
(including that every href `apps/api/src/routes/me.ts` can return has a label
key both catalogues translate), generic row title/subtitle/field derivation, the
sign-in step machine (which screen a login response and a 403 `mfa_required`
each land on), and i18n + brand-token resolution — including the typeface
mapping (the approved three, and that an unapproved or prototype-chain value
never reaches a style) and all three accent tokens.

**Nothing renders in the tests.** There is no component test: that needs
`jest-expo` and a React Native transform, which is a second test runner in the
monorepo. Add it when there is component logic worth asserting — right now the
screens are mostly layout over the tested helpers.
