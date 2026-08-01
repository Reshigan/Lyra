# ADR-0016 — SCOUT wording differ takes plain text; PDF extraction deferred

- Status: accepted
- Date: 2026-08-01
- Context: CLAUDE.md:4-6 (ambiguous spec → ADR), CLAUDE.md rule 15 (seams),
  docs/modules/scout.md §2.3, docs/25-go-live-checklist.md M5 SCOUT row,
  packages/core/src/wording-diff.ts, apps/api/src/routes/scout.ts

## Context

`packages/core/src/wording-diff.ts` already has a real, dependency-free
`diffWords(a, b): DiffSpan[]` — word-level diff between two coverage-wording
texts, used to show a provider negotiation what changed between two policy
wordings. It had no caller: no route mounted it.

The natural source for "two coverage wordings" is a pair of policy wording
PDFs, not two pasted strings. Extracting clean, diffable text from an
arbitrary PDF (multi-column layouts, embedded fonts, scanned pages) is a
project of its own — this environment has no PDF-text-extraction dependency
on the approved list (docs/02 §9), and adding one is a call an ADR should
make deliberately, not one bundled into wiring a diff function to a route.

## Decision

1. `POST /v1/scout/wording-diff` (apps/api/src/routes/scout.ts) takes
   `{ textA, textB }` as plain text and calls `diffWords` directly. Gated on
   `scout:panel_bench:read` — the closest-fitting existing permission, since
   this diff exists to feed panel-bench negotiation packs (§2.5), not as a
   general-purpose text tool.
2. PDF-to-text extraction is deliberately out of scope for this pass. A
   caller with a wording PDF today extracts text itself (copy/paste, or an
   external tool) before calling this route.
3. docs/25-go-live-checklist.md's M5 SCOUT row is updated to point here
   instead of carrying the wording differ as an unscoped gap.

## Consequences

- Two pasted wording texts diff today, word-for-word, audited nowhere further
  (a read-only diff carries no `ai_audit_log` or `consequential` obligation —
  it does not decide or send anything).
- Wiring a real PDF straight into this route is future work behind its own
  ADR, once a PDF-text-extraction dependency is chosen.
