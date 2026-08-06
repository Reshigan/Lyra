# Horizon — frontend conversion design

Source: Claude Design project `2c81f410-f688-45f3-abb3-904498f9c06d`, file
`Lyra Horizon.dc.html` (2,428 lines as retrieved). Sibling file `support.js` is
the design tool's generated `dc-runtime` preview renderer — not design content,
not a dependency of this work.

**Ingest caveat.** The MCP `get_file` call is capped at 256 KiB and
`Lyra Horizon.dc.html` is larger, so the retrieved copy ends mid-string inside
`runs[0].scope`. The entire template (lines 1–1972) and ~95% of the component
script were read. What is missing is tail data literals only: the rest of
`runs`, `close`, the ledger-rail entries, the autonomy envelope cards, the
doctrine cards, the palette swatch list, the mobile companion data, the Where
destinations, the surface definitions and `render()`'s return. Every one of
those has its markup read and at least one data sample, so nothing in this spec
is guesswork about shape — only about the specific strings in a few lists, and
those come from LYRA's own data anyway.

## 1. What Horizon actually is

Horizon is not a new information architecture. It is a **visual and editorial
grammar** applied to the same surfaces LYRA already ships, plus one structural
idea: the home screen is *role-specific and answered*, not a dashboard.

Read against the repo, the design is startlingly native: its six personas carry
the exact role keys in `packages/core/src/rbac.ts`; its accent is the existing
`--vega-500` `#C8F163`; its five module hues are byte-identical to the existing
`--module-*` tokens; all five of its typefaces are already self-hosted in
`packages/ui/src/tokens.css`. So this is a **retune and a re-frame**, not a
re-skin. The work is concentrated in three files that reach all 112 routes.

The grammar, in one list:

- **Hairline, not shadow.** `1px solid var(--line)` on `var(--s2)`; elevation is
  the near-invisible `--elev` (`0 1px 1px #0F172A0A, 0 4px 14px #0F172A08`), and
  in dark theme `--elev: none`. Radius drops from 10px to 3px.
- **The eyebrow.** Every block is introduced by 9.5px uppercase mono/ui text at
  `.16em` letter-spacing in `--tx5`. This replaces most card titles.
- **Serif for the sentence.** Instrument Serif 23px, one sentence, states the
  finding. Never a label, never a button, never repeated.
- **Mono for every number, id, tick and key.** IBM Plex Mono. A figure rendered
  in the UI face is a bug.
- **The 2px hue bar.** Provenance and category are a 2px left border in the
  module hue, not a badge.
- **✦ and a why.** Every AI artifact carries the single mark plus an
  inspectable one-line rationale. Already `AGENT_MARK` in `packages/ui/src/ai.tsx`.
- **Answered, not displayed.** The primary surface states a conclusion with its
  latency and source, then offers exactly three actions.

## 2. Token map

`packages/ui/src/tokens.css` keeps its structure (raw palette → semantic dark →
semantic light ×2 → `@theme inline`) because `contrast.test.ts` reads the file
positionally: dark declares each semantic token first, light re-maps it last.

New semantic families, dark value / light value:

| Family | Tokens | Purpose |
|---|---|---|
| Text ramp | `--tx0 … --tx6` | Six-step foreground ramp. Today's `--text/-muted/-subtle` become aliases onto `--tx`, `--tx4`, `--tx5`. |
| Line ramp | `--line`, `--line2`, `--line3`, `--line4` | Hairline → focus ring. Existing `--border/-strong/-strongest` alias onto 1/2/3. |
| Surface ramp | `--s1 … --s4`, `--s2b`, `--track` | `--surface-1/2/3` alias onto `--s2/--s3/--s4`. `--track` is the slider/meter groove. |
| Status triplets | `--ok-bg/-line/-tx/-tx2`, `--warn-*`, `--bad-line`, `--north-bg/-line/-tx`, `--scout-bg/-line` | Tinted chip backgrounds. Replaces the current `-soft`/`-line` pairs, which stay as aliases. |
| Depth | `--elev`, `--elev2`, `--shadow`, `--shadow2`, `--scrim`, `--sel` | `--sel` is the selection wash `#3F62121F`. |
| Field | `--star-op`, `--neb-op`, `--sky1`, `--neb1`, `--neb2`, `--star` | Starfield opacity is `0` in light, `.18/.55` in dark. The field is already `.lyra-field`. |

Palette moves:

- Light `--bg` goes `#FFFFFF` (from the current off-white); `--s3 #F4F6F9`,
  `--line #E6E9EE`, `--tx #0E1116`.
- Dark `--bg` goes `#06080B`, `--s2 #0A0D13`, `--line #131926`, `--tx #EDF1F7`.
- Light accent is `--acc #3F6212` / hover `#33500E` on white text; dark accent
  stays `#C8F163` on `#06080B`. This is the current `--vega-700`/`--vega-500`
  split with a slightly deeper light value — contrast improves, so
  `contrast.test.ts` stays green.
- Module hues unchanged in dark; light gets Horizon's `--axis #B45309`,
  `--orbit #00786A`, `--signal #C2410C`, `--scout #1D4ED8`, `--north #6D28D9`.
- `--radius-md` 10px → 3px, `--radius-sm` 6px → 2px. `--radius-lg` and
  `--radius-orbit` unchanged (the pill is still a pill).

`brandStyle()`'s five-property tenant override contract (`--accent`,
`--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`) is
unchanged. Tenant brand still wins.

## 3. Grammar primitives

New in `packages/ui/src/horizon.tsx`, exported from the package index:

| Primitive | Renders |
|---|---|
| `<Eyebrow>` | 9.5px `.16em` uppercase `--tx5` label. Optional `module` tints it. |
| `<Lede>` | Instrument Serif 23px/1.25 one-sentence finding, `max-inline-size: 84ch`. |
| `<Figure value unit delta>` | Mono figure + small unit + signed delta in `--ok`/`--bad`. |
| `<HueBar module>` / `hueVar(module)` | The 2px provenance bar and its CSS var. |
| `<Hairline>` | `1px --line` rule with optional inline label. |
| `<AutoGrid min>` | `repeat(auto-fit, minmax(min, 1fr))`, default 320px. |
| `<Panel eyebrow lede hue>` | The Horizon card: hairline on `--s2`, `--elev`, 3px radius, eyebrow header, optional hue bar. |
| `<AnswerBanner>` | ✦ + "Answered for {role}· {source}" + mono latency + `<Lede>` + up to three action chips. |
| `<Provenance rows>` | The confidence table: label, strength chip, note. Renders "low — labelled correlation" in `--bad` with its "not used as a lever" note, per the design. |

`Card`, `Badge`, `Stat`, `Table`, `Tabs`, `Input`, `Button` are retuned in
place — same props, same call sites, Horizon proportions. No route file changes
to consume the new look.

## 4. Shell anatomy

`apps/web/app/components/shell.tsx` becomes the Horizon frame. Structure, top
to bottom:

1. **Field** — fixed starfield behind everything, opacity `0` in light.
2. **Top bar, 50px.** Tenant lockup (constellation mark + tenant wordmark from
   brand config, never the literal "LYRA") · centre **ask bar** (31px,
   borderless, pulsing accent dot, "All surfaces ⌘K") · right cluster: Money and
   Ledger chips, theme toggle, companion toggle, **role pill** (tinted initials
   circle + mono role key + ▾).
3. **Nav.** Horizon shows no sidebar; it uses a "Where would you like to go"
   overlay. Removing the sidebar outright would cost WCAG 2.4.5 (multiple ways)
   and would strand every screen-reader user on an overlay behind a button.
   Resolution: **keep `<NavRail>` as the persistent `<nav>` landmark**, restyled
   to Horizon (hairline, eyebrow group headings, 2px hue bar on the active item,
   no dots), and add the Where overlay as ⌘K's second pane — a faster door, not
   the only one. This is a deliberate divergence from the design; recorded as
   ADR-0031.
4. **Meridian strip** (74px, draggable, replay left / project right) —
   rendered only on surfaces that declare a time axis. Keyboard: left/right
   arrows scrub, Home/End jump, value announced via `aria-valuetext`.
5. **Answer banner**, when the route has an answer to state.
6. **Main**, unchanged landmark and skip target.
7. **Ledger rail** (right, collapsible) with the autonomy-envelope footer.
8. **Status bar**, **toast**, **doctrine overlay**, **roles overlay**.

The theme toggle writes `data-theme` on `<html>` and persists to the existing
`lyra_theme` cookie mechanism, matching how `lyra_locale` already works.

## 5. The profiles

Horizon's six personas are the six existing RBAC roles. Nothing is invented;
seeded names stay as they are in `packages/core/src/seed.ts`.

| Horizon persona | Role key | Seeded user | Hue | Journey | The shell it gets |
|---|---|---|---|---|---|
| Chief Executive | `north.exec` | Hala Zayed | `--north` | J-E1 the 7am read | A reading surface. One narrated page, three decisions. No tables, no filters. |
| Ops Agent | `axis.agent` | Layla Hassan | `--axis` | J-O1 exception clearing | One case at a time, full width, keyboard first; the line hands over the next thing. |
| CX Agent | `orbit.agent` | Sara Al Nasser | `--orbit` | J-X1 handover catch | A conversation, RTL-native, AI draft as ghost text accepted with one key. |
| Growth Lead | `signal.lead` | Noor Jamal | `--signal` | J-M2 budget morning | Dials, not campaigns; anything reversible within seven days. |
| Head of Product | `scout.pm` | (scout.pm seat) | `--scout` | J-P1 radar quarterly | A radar and a dossier; every claim links to the signal that produced it. |
| Compliance Officer | `tenant.compliance` | Khalid Al Rashed | `--ok` | J-CO1 regulator request | Sealed evidence, no edit affordances anywhere — absent, not disabled. PII masked unless reason-coded. |

Binding: `packages/core/src/lens.ts` already resolves a default workspace per
role. Horizon's per-role *content* (shift list, tasks, the answer `ask()`
returns) is added as a `profile` module in `packages/core` keyed by the same
role keys, consumed by `routes/home.tsx`. `login.tsx`'s persona buttons already
render name + mono role key — that is Horizon's roster idiom and stays.

The role pill switches the *view*, never the permissions. A user sees only the
profiles their roles grant; a single-role user gets a pill with no menu.

## 6. Propagation and no-feature-loss

Order of work, each step shipping a visibly converted product:

1. tokens → every screen changes at once, no route edits.
2. primitives retune → cards, tables, badges, stats take Horizon proportions.
3. shell → the frame.
4. `routes/home.tsx` → the role-answered surface. Its six existing panels
   (approvals, AI runs, unit economics, area movement, journeys, doors) become
   Horizon panels behind the answer banner; none are removed.
5. Per-module passes, in this order: north, axis, orbit, signal, scout, ledger,
   admin/compliance. Each pass converts headings to eyebrow + lede, figures to
   mono, category badges to hue bars, and adds the ✦ + why to any AI output
   that lacks it.

**Nothing is deleted.** The conversion may not remove a route, a loader, an
action, a permission check, a form field, or a table column. Where Horizon
shows less than LYRA has, LYRA's extra content moves below the fold or into a
disclosure — it does not disappear. The check is mechanical: `routes.ts` line
count and each route's exported `loader`/`action` set are unchanged at the end
of every pass.

Invariants carried by the design copy, all of which already hold in the code and
must continue to hold: dual control above threshold with no auto-approve
allowlist for client-money, payout or regulatory-floor types; the 0.90
confidence floor recorded on bulk approval; 7-day reversible autopilot; 8%
frozen holdout; sealed contra-only audit bundles; masked PII with reason-coded
unmask; k-anonymity ≥ 20; ranges not point estimates; correlation labelled and
not used as a lever; REASONING tier fails loudly; never train on tenant data;
prompt and response logged 90 days; posted ledger lines carry no edit
affordance in the DOM; client-money invariant `1010 ≥ 2010`; `pending_external`
is a named state, not a spinner; every saga step has a compensation.

## 7. Non-goals

- No `.dc.html` runtime. Horizon's dialect is a design-tool format; the output
  is ordinary React Router + Tailwind.
- No new dependency. Every effect in the design is CSS.
- No change to the API, the schema, RBAC, or the event envelope.
- No mobile rewrite in this spec. `apps/mobile` follows once the token layer
  lands, and parity is noted per PR as the DoD requires.

## 8. Tests

- `contrast.test.ts` — unchanged file, must stay green on the new palette.
- `packages/ui/src/horizon.test.tsx` — each new primitive renders its
  semantics: eyebrow is not a heading, `<Lede>` is, `<AnswerBanner>` exposes the
  ✦ mark and the why, `<Figure>` marks its delta with a sign and a tone.
- `e2e/pseudo-locale.spec.ts` — the existing dense-screen sweep (`/`,
  `/approvals`, `/admin/customers`) must hold: ≤ 1px overflow and zero axe
  violations in pseudo and Arabic. The Horizon shell's fixed-width top-bar
  cluster is the risk; the ask bar shrinks before the role pill does.
- New `e2e/horizon-shell.spec.ts` — the nav landmark exists without opening any
  overlay; the theme toggle flips `data-theme` and persists; the Meridian is
  keyboard-scrubbable; the role pill offers only granted profiles.
- Arabic copy for every new string goes through `docs/26-arabic-glossary.md`
  terms; new concepts add a glossary row in the same change.
