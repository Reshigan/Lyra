# 22 — UI Design: Transaction, Social, Launch & Builder Surfaces

Extends docs/07 (Constellation system) and docs/15 (Experience Excellence) to
the surfaces introduced by docs/19–21. Same tokens, same premium bar, same
ambient-AI grammar — applied to money, content and configuration, which each
carry their own trust requirements.

## 1. Money surfaces — designing for immutability and trust

**Design thesis.** Financial UI earns trust by making irreversibility visible.
Posted entries must *look* sealed; anything editable must look editable. No
ambiguity, ever.

**Sealed treatment.** Posted journal lines render on `ink-800` with a 1px
`ink-600` inner ring, a hairline left rule in `ion-500`, no hover elevation, and
no edit affordance in the DOM at all (not disabled — absent). Draft/pending
transactions render on `ink-700` with a dashed rule and visible controls.

### 1.1 Ledger Explorer
- Virtualised journal table: date · txn code · description · account · debit ·
  credit · currency · base equivalent · batch · actor. Tabular numerals
  throughout; debits and credits in separate columns, never signed in one.
- Sticky trial-balance footer that recomputes live and shows the balance check
  as a single ✓/✗ chip — the most important pixel on the screen.
- Filters: account, transaction type, actor, currency, period, amount range;
  natural-language filter compiles to a visible query (docs/15 §4.6).
- Every row expands to the full transaction envelope; every row exports with its
  evidence manifest.

### 1.2 Money Map
- Sankey of value flow for a period: premium in → insurer remittance → commission
  retained → partner share → tax → net. Nodes are clickable to filtered journals.
- Client-money segregation shown as a distinct, always-visible bar: cash held vs
  obligations, with the invariant margin. If it ever narrows, the bar turns
  `flare-500` and the Money Map surfaces a `CM-BREACH-FLAG` banner above
  everything else on the page.

### 1.3 Transaction Detail
- Left: state-machine timeline (initiated → … → settled) with timestamps, actor
  chips (human/agent + autonomy level), and any `pending_external` waits shown as
  named steps, not spinners.
- Centre: journal lines (sealed), amounts with currency + base, saga steps with
  compensation status.
- Right: approvals (who, when, reason), guardrail results (consent, disclosure,
  sanctions), evidence list with hashes, and — where AI participated — the
  reasoning summary with an evidence link.
- Footer: `Reverse` and `Adjust` as deliberately low-glamour, permissioned
  controls that open a reason-coded dialog; never one-click, never primary-styled.

### 1.4 Reconciliation Workbench
- Three panes: **statement** (imported) · **system** (our transactions) ·
  **variance**. Matched pairs collapse; variances stay open with a reason
  taxonomy.
- AI-proposed matches appear as ghost pairings with confidence, accepted with a
  single keystroke and never auto-posted (docs/19 §6). Bulk-accept requires a
  confidence floor and logs a single approval covering the batch.
- Progress ring shows match rate against target; export produces the evidence
  bundle.

### 1.5 Settlement Runs & Period Close
- Run cards: scope, counts, totals, exceptions, approver, state. A run cannot be
  approved with open exceptions — the button explains why rather than disabling
  silently.
- Period Close: a checklist with owners (recognition, revaluation, recon
  sign-offs, client-money proof), each item linking to its evidence; close is a
  single irreversible action with a confirmation that states what becomes
  contra-only afterwards.

## 2. Social Studio

### 2.1 Composer
- Three-column: **content** (copy fields per platform, variant tabs, asset rail)
  · **live previews** (real per-platform chrome: IG feed/reel, TikTok, X, LinkedIn,
  FB, YouTube, WhatsApp) rendered side by side and re-rendering as you type ·
  **governance** (compliance chip, disclosures, approvals, schedule).
- The compliance chip is the gate: grey → checking → green (pass) or amber
  (flagged, with the specific rule quoted) or red (hard block). **The schedule
  control does not exist until the chip is green** — no disabled-button
  guesswork.
- Arabic and English shown as parallel columns, each with its own preview and
  its own review state; RTL previews are genuinely RTL, including caption
  truncation behaviour.
- Ghost text throughout (docs/15 §4.1); the ✦ marker on AI-drafted fields;
  per-field "why this angle?" evidence popovers back to the brief.
- Aspect-ratio strip shows every derived crop with safe-area overlays; a crop
  failing a platform's safe area is flagged before publish, not after.

### 2.2 Calendar
- Month/week with **channel lanes**, colour-coded by pillar (not by channel —
  pillars are the strategy). Drag to reschedule within permitted windows;
  blackout windows and market holidays shown as ruled bands.
- Density controls; a "gaps" overlay highlights cadence shortfalls per pillar and
  market. Hovering a slot shows the preview thumbnail plus its approval state.

### 2.3 Publish Queue & Channel Health
- Queue rows show attempt state per target with the platform's returned id on
  success and the platform's own error text on failure (never a generic
  "something went wrong").
- Channel Health strip: token validity, permission scope, rate-limit headroom,
  and — critically — an explicit **"assisted publish only"** badge where a
  platform's policy or app-approval state prevents direct posting (docs/20 §9).

### 2.4 Inbox & Listening
- Triage queue, keyboard-first (J/K, 1–9 dispositions), with intent and sentiment
  chips, language flag, and a single-key handover to ORBIT when licensed.
- Listening board: topic momentum, share-of-voice, and a crisis lane that pins
  above the fold with an escalation path and an owner.

## 3. Launch Cockpit

- A horizontal **gate rail**: Evidence → Product → Pricing → Compliance →
  Content → Channels → Paid → Launch → Measure. Each gate is a card with owner
  avatar, state chip, blocking-items count, and a countdown to the target date.
- Clicking a gate slides in its workspace; the rail stays visible so the whole
  launch is always legible at a glance.
- The Launch Conductor's chase list appears as a quiet ledger ("2 owners nudged,
  1 gate at risk"), never as nagging modals.
- Post-launch, the same rail becomes the retrospective: planned vs actual per
  gate, and the measured outcome from the metric layer.

## 4. Builder surfaces

### 4.1 Bot Builder (Lyra Bots edition)
- Flow canvas with typed nodes (message, ask, branch, tool call, handover, wait),
  live validation, and unreachable-path warnings.
- Right rail: persona, tone, guardrails, knowledge sources, tool matrix with
  scope badges (read/write/consequential).
- Test console: scripted personas (including Arabic dialect personas), replayable
  transcripts, and a diff view when a change alters behaviour on saved cases —
  the closest thing to unit tests inside the product.
- Deploy: draft → sandbox → live with a visible diff and one-click rollback.

### 4.2 Domain Pack Configurator
- Two-column mapping table (Lyra primitive → tenant vocabulary) with a live
  preview panel that re-renders three real screens using the new vocabulary, so
  the effect is seen before saving.
- Compliance floors shown as locked rows with a padlock and an explanation —
  visibly not editable.
- Diff + version history; entity remapping warns that it is not a live-safe
  change.

### 4.3 Journey, SOP, Audience & Metric builders
Consistent shell for all low-code builders: canvas/table, versioning header
(draft/published + version chip), **Simulate** as a primary action, diff-on-
publish, rollback in the version menu, and guardrail floors rendered as locked
elements. One grammar learned once.

## 5. Cross-surface rules

1. Money always shows currency and base-currency equivalent; never a bare number.
2. Anything irreversible states its consequence in the confirmation, and names
   the reversal path if one exists.
3. Anything AI-produced carries ✦ and explains itself within one interaction.
4. Anything gated shows the gate and the reason, not a disabled control.
5. Anything platform-limited shows the limitation and the fallback path.
6. Every builder can be simulated before it is published.
7. Every list is keyboard-navigable, saved-viewable and exportable within
   permission.
8. All of the above verified against the 20-point premium bar (docs/15 §6) per
   release, including RTL, dark/light, and reduced-motion parity.
