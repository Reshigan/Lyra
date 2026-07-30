# 15 — Experience Excellence: Premium Craft, Role Lenses & Ambient AI

This is the bar. Constellation (docs/07) defines the system; this doc defines
what "world-leading" means in measurable, testable terms — the latency
doctrine, the motion language, the per-role Lens engine, and the grammar for
AI that is everywhere and almost invisible.

## 1. The feel we are building

Open LYRA and it feels like a precision instrument warmed up before you
arrived: your workspace is already arranged for the hour of your day, the
number you came to check is already surfaced, the reply you were going to
write is already ghosted under your cursor — and none of it shouts. Premium
here means restraint executed perfectly: dark glass, luminous data, zero
jitter, zero dead ends, and intelligence that behaves like a great chief of
staff, not a mascot.

## 2. Latency doctrine (perceived performance is designed, then asserted)

| Interaction | Budget | Technique |
|---|---|---|
| Keystroke echo / toggle | < 16ms | never block main thread; input handlers pure |
| Local action commit (optimistic) | < 100ms | optimistic UI + outbox, reconcile silently |
| Navigation (warm) | < 300ms | prefetch on hover/viewport intent; RR7 data preload |
| AI stream first token | < 1.5s cloud / < 3s on-prem | streamed always; ghost skeleton of answer shape |
| Anything > 400ms | skeleton, never spinner | skeletons mirror final layout exactly (CLS < 0.02) |
| Anything > 3s | progress + narrative ("ranking 7 insurers…") | Workflows report step names |

Rules: no spinner larger than 20px anywhere; no full-screen loaders after
app boot; data appears oldest-cached-first with a staleness whisper, then
live-refreshes with the twinkle animation (opacity 0.85→1). Every budget is a
CI assertion (docs/13 §4).

## 3. Motion & material language

- Curves: `--ease-observatory: cubic-bezier(.2,.8,.2,1)` for entrances;
  `--ease-settle: cubic-bezier(.3,.7,0,1)` for layout shifts. Durations
  120/180/240ms (small/medium/orchestrated). Entrance stagger 20ms per item,
  max 8 items then group.
- Physical continuity: things move from where they were (shared-element
  transitions between list→detail via View Transitions API; mobile shared
  transitions via Reanimated).
- Live numbers tick with a 250ms count-up capped at 3 changes/sec; deltas
  pulse once, never loop. Charts draw in 400ms once per mount, never on data
  refresh.
- Reduced-motion: full parity — every animation has an instant equivalent;
  motion is garnish, never information.
- Material: surfaces rise by getting lighter (ink-800→600) with a 1px inner
  ring, not shadow soup; focus is a 2px vega ring with 2px offset;
  glass/blur is banned; gradients only in data-viz density maps.

## 4. Ambient AI grammar (subtle, then suddenly indispensable)

Principles: AI completes intent rather than interrupting it; presence scales
with stakes; everything inspectable; everything undoable at autonomy ≤ L2;
silence is a feature. The **only** AI mark in the product is a single ✦.

The pattern inventory (new AI surfaces must use one of these or ADR a new one):

1. **Ghost text** — anywhere text is written (replies, briefs, notes): AI
   draft renders as 40%-opacity continuation; Tab accepts, keep typing
   dismisses, Alt+Tab cycles 3 candidates. Never auto-sends.
2. **Quiet chips** — one-line predictions with confidence dots under the
   relevant object ("likely to renew · ●●○"); hover reveals the why
   (evidence popover); click pins to the object.
3. **Background drafts** — long work happens off-screen: "3 renewal offers
   drafted ✦" appears as a tray item, not a modal. Review-and-release UX.
4. **Forecast strip** — top-of-workspace, max 3 items, ranked by stakes
   ("VIP case will breach SLA in ~4h — reassign?"). Each has one action and
   an explicit dismiss that teaches the ranker.
5. **Whisper dots** — module glyphs in the rail get a 4px pulse when the
   module's agent found something material; never numeric badges > 9, never
   red unless consequential.
6. **Semantic everything** — ⌘K and every table filter accept natural
   language ("motor cases stuck on docs > 3 days") compiled to visible,
   editable structured filters — the compilation shown, so trust builds.
7. **Explain-on-hover** — any AI-produced value (score, ranking, extraction)
   answers "why?" in ≤ 1 hover: source fields, model tier, confidence,
   timestamp. This affordance is universal and tested.
8. **Escalating presence** — informational = chip; suggested action =
   forecast strip; consequential = ApprovalStrip with full reasoning +
   biometric on mobile. AI never uses toasts or modals for itself.
9. **The quiet ledger** — per user, "what AI did for you today" digest
   (drafts accepted, minutes saved, actions taken at L2) — builds calibrated
   trust and doubles as the autonomy audit surface.
10. **Undo-first autonomy** — every L2 action ships with a one-click reversal
    window where the domain allows; irreversible domains stay L1 by design.

Anti-patterns (rejected in review): sparkle buttons on every field, chat
bubbles floating over workspaces, unsolicited modals, confidence theatre
(fake precision), AI-splaining paragraphs where a chip suffices.

## 5. The Lens engine — fully customized to each role

A **Lens** = role default workspace + learned personal adaptation. Shipped in
packages/core/lens; state in `core_lenses` (user_id, role_key, layout_json,
pins_json, rhythm_json, version).

- **Role defaults** (from docs/06): exec lands in NORTH Today; ops in
  Production Board; agent in Console — each with role-tuned density,
  vocabulary (the same object is "case" to ops, "customer moment" to CX,
  "unit economics input" to exec), and KPI selection.
- **Personal adaptation (transparent, resettable):** pinned entities and
  saved views float up; ⌘K learns the user's verbs (frecency); the Forecast
  strip learns from dismissals; module rail reorders by usage after 2 weeks
  (with an "arranged for you — restore default" affordance).
- **Rhythm awareness:** time-of-day states — exec 06:00–09:00 gets Brief
  reading mode by default; ops month-end gets Recon promoted; agent shift
  handover gets the handoff summary front and center. Rhythms are rules in
  lens config, learned suggestions require accept-once.
- **Progressive density:** new users get comfortable spacing + labels;
  power signals (keyboard-nav usage, tenure) unlock compact mode + shortcut
  hints; never auto-switch without an accept.
- **"Why am I seeing this?"** is available on every personalized element;
  one-click reset per surface and globally. Personalization data is
  per-user, exportable, erasable — it follows docs/12 like any PII.
- Same Lens state powers web and mobile (tabs, default screens, notification
  weights), synced via the realtime channel.

## 6. The premium bar (20-point craft checklist — every screen, every release)

1 all six states designed: empty/loading/error/partial/offline/degraded-AI ·
2 skeleton mirrors final layout · 3 zero CLS on load · 4 keyboard path for
every action · 5 focus order sensible, ring visible · 6 RTL flawless ·
7 Arabic copy native, not translated chrome · 8 tabular numerals in all
metrics · 9 empty state teaches one action · 10 error states carry trace_id +
next step · 11 hover/pressed/disabled states distinct · 12 touch targets ≥
40px · 13 dark AND light verified · 14 tenant accent applied, contrast AA ·
15 motion has reduced-motion parity · 16 no spinner > 400ms rule holds ·
17 every AI value explains on hover · 18 undo where promised · 19 print/PDF
clean where relevant (Brief, packs, bundles) · 20 screen reads correctly
aloud (screen-reader pass).

Items 2,3,4,12,14,16 are automated assertions; the rest are a manual pass
logged per milestone (docs/13 §6). A screen that misses the bar doesn't ship
— premium is a gate, not a mood.
