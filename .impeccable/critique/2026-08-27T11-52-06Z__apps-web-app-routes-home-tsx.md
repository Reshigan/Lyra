---
target: / (home.tsx)
total_score: 30
p0_count: 1
p1_count: 2
timestamp: 2026-08-27T11-52-06Z
slug: apps-web-app-routes-home-tsx
---
Method: dual-agent (A: a0c94b2c807bdfb1c · B: a67fea6ba0443ecc1). No browser automation available — no rendered-page evidence, no overlay. Target is the index route `/` (routes.ts:25), not `/home`; `/center` is a separate file (command-center.tsx).

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 4 | Panel tri-state + per-row busyId |
| 2 | Match to real world | 3 | humanise(run.agentKey) surfaces minted codes (home.tsx:948) |
| 3 | User control & freedom | 2 | Approve/reject one click, no confirm, no undo (:772-773) |
| 4 | Consistency & standards | 4 | One Stat/Figure for every number |
| 5 | Error prevention | 2 | Same root cause as #3 |
| 6 | Recognition over recall | 3 | names() resolves ULIDs; run purposes stay codes |
| 7 | Flexibility & efficiency | 3 | ⌘K navigates only; no keyboard path to approve/reject |
| 8 | Aesthetic & minimalist | 3 | ~40-48 interactive elements on first paint |
| 9 | Recover from errors | 4 | PanelFailure with reference id; denied != failed at type level |
| 10 | Help & documentation | 2 | No inline help, no first-run tour vs zero-training goal |

Total: 30/40 — Good.

## Anti-Patterns Verdict

LLM (A): clean. Zero gradient text, zero glassmorphism (banned at shell.tsx:317), zero numbered scaffolding, asymmetric grid not identical cards, overflow well handled.
Deterministic (B): detector exit 2, 5 hits all one rule (overused-font) all in tokens.css, zero in home.tsx. 3 of 5 are substring false positives ("Inter" inside "Instrument"). Genuine 2, both spec-pinned by docs/01-brand.md §3.
Overlays: none, no browser tool.
Correction B supplied: grep counts 1 Eyebrow, rendered count is 4 — lines 723/742/967 hand-copy the class string onto <h2> for outline reasons. 4 eyebrows against 3 landmarks.

## What's Working

1. Panel<T> as a three-state type (:330) — {ok}|{denied}|{error} enforced by compiler; PanelCard returns null for denied.
2. HeroStat is a door to its own rows (components/hero.tsx:11-24) — figure and list from one predicate, cannot disagree.
3. names() batch resolution (:386-393) — fixed at the seam all three panels route through.
4. Contrast holds: every muted/subtle-on-surface pair clears AA, worst 5.02. Reduced motion honoured globally.
5. All 8 interactive elements carry an accessible name. Zero unnamed.

## Priority Issues

P0 — Approve/reject commit on one click, no confirm, no undo (:772-773). consequential:true per CLAUDE.md §4. Server policy stops unauthorised, not misclicked. approvals.failed reassurance arrives only after failure. Fix: two-stage on the home strip only, or 5s undo via the mounted ToastProvider (shell.tsx:307).

P1 — ~40-48 interactive elements on first paint, no ranking. 4 cognitive-load fails = HIGH. Landing screen for the least-oriented reader (:40) against a zero-training goal. Fix: let the answer branch at :592-598 drive layout structurally, not just copy.

P1 — Workspace-tile grid duplicates the sidebar rail exactly (:576 uses routedLeaves, same helper as shell.tsx:262). Largest block, last thing seen, zero new information. Fix: delete :965-990, keep links[0] in EmptyState.

P2 — approvals.all renders twice, same label and destination (:674, :793).

P2 — humanise(run.agentKey)/humanise(run.purpose) (:948,:955) surface minted identifiers. Violates CLAUDE.md §14. moduleName(t,…) at :888 is the seam this caller skips. Dead-seam shaped.

P2 — contrast.test.ts guard hole: 14 assertions over 7 pairs, never tests --text-muted in either theme, only ever uses --bg as background, so surface-1/2/3 and --track are unguarded including the card surface where most body text sits. Passes today; guard gap not live defect.

## Persona Red Flags

Sam (AT): aria-live missing on every mutation. Failure announced (role=alert :731,:1071), success never. Decided strip vanishes, focus falls to body. Invisible in tests because home.test.tsx calls the component, not the AT. Four panel h3s orphaned under a bare div (:801).
Alex: ~8 Tab presses to approval #3; focus resets after every decision.
Jordan: journey band prints raw module codes and feeds one identically-styled mono column three unrelated value types (currency / audience string / bare count). "Welcome back" on a first-ever visit — barren fires only when every panel is empty.

## Minor Observations

- RUN_TONE maps refused → danger (:549). A refusal is correct behaviour; red teaches otherwise.
- Module hues used as text colour at text-13 (steps-section.tsx:21); --module-* are identity hues. Needs a rendered check.
- AnswerBanner (horizon.tsx:293) exists for this screen's purpose and is not imported; opening hand-rolled at :660-678.
- Retry is a full document reload (:1074), discarding six panels that loaded fine.
- problem alert renders above the strip that caused it, off-screen after approval #3, no scroll-into-view.
- steps-section.tsx:19 min-w-[11rem] × 4 inside overflow-x-auto scrolls below ~44rem.

## Questions to Consider

1. The h1 names one waiting decision, the page offers forty doors. If it means the approvals section, why is that fourth in visual order, below a demo journey band?
2. Why is the flagship demo journey the second-most prominent block on every tenant's production landing screen?
3. AnswerBanner was built for exactly this thesis. Rejected because the answer is arithmetic rather than agent output, or never wired?
4. Panel denied renders nothing, so a permissionless reader sees a shorter home and is never told why. Sighting 14's shape one level up?
