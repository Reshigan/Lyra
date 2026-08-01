# ADR-0017 — NORTH briefing/boardpack routes wired; Metric Explorer chart annotations deferred

- Status: accepted
- Date: 2026-08-01
- Context: CLAUDE.md:4-6 (ambiguous spec → ADR), CLAUDE.md rule 15 (seams),
  ADR-0009 (no charting library), docs/modules/north.md §2.2/§2.5/§4/§8,
  docs/25-go-live-checklist.md M6 NORTH row, apps/api/src/engines/narrator.ts,
  apps/api/src/engines/north-boardpack.ts, apps/api/src/routes/north.ts,
  apps/api/src/crud.ts:440-469

## Context

Two gaps were found under the M6 NORTH row:

1. `engines/narrator.ts`'s `generateBriefing` was complete — snapshot build,
   model-gateway call, numeric-claim verification, highlight extraction, DB
   insert — but had zero route callers. Same shape, a `north_boardpacks`
   table existed with a `pdfFileId` column but no assembly engine ever wrote
   one; the generic CRUD `create` for boardpacks would accept whatever
   `sectionsJson`/`pdfFileId` a client posted, with no real render behind it.
2. docs/modules/north.md §8's fourth acceptance bullet: "a metric definition
   change shows as a chart annotation from the change date." The Metric
   Explorer screen (§4, "chart canvas with annotations") does not exist.

## Decision

1. `POST /v1/north/briefings/generate` (apps/api/src/routes/north.ts) wires
   the already-correct `generateBriefing` engine to a route, gated on
   `north:briefings:generate`, mirroring signal.ts's `/creatives/generate`.
2. `POST /v1/north/boardpacks` is overridden ahead of generic CRUD (same
   mounting-order idiom as `/v1/ai/runs`) with a real assembler
   (`engines/north-boardpack.ts`): pulls the latest exec briefing's
   highlights, the period's metric snapshots and the open decision log,
   renders them through the existing `toPdf` (no new PDF pipeline), and
   persists the bytes via R2 + `core_files`, same shape as analytics.ts's
   `storeExport`. Status lands on `"review"`, never `"final"` — rule 4
   (human-in-the-loop): distribution is the consequential step here (§3's
   Pack Assembler agent row: "distribution = approval"), not assembly, and no
   approval/distribution route exists yet. That workflow (approve →
   distribute → `distributionLogJson` read-receipts) is out of scope for this
   pass and is not this ADR's subject — it is a lifecycle/UI feature, tracked
   separately, not a fabricated-data problem.
3. The Metric Explorer chart-annotation UI is deliberately **out of scope**
   for this pass. The data it would need already exists with no new code:
   `crud.ts`'s generic update handler audits every mutation with full
   before/after (`audit(ctx, { action: `${auditName}.update`, subjectRef,
   before, after })`), so a `north_metrics` definition change is already a
   `core_audit_log` row with the changed fields and a timestamp. What is
   missing is purely a rendering surface: a chart canvas that plots
   `north_snapshots` over time and overlays a marker at each
   `core_audit_log` timestamp for that metric's row. Per ADR-0009, this
   codebase hand-rolls charts rather than pulling in a charting library —
   raising a first chart canvas from nothing, with annotation overlays, is a
   frontend build of its own, disproportionate to bundle into wiring two
   backend routes.
4. docs/25-go-live-checklist.md's M6 NORTH row is updated to record briefing
   generation and boardpack assembly as real, and to point the chart-
   annotation acceptance criterion at this ADR instead of carrying it as an
   unscoped gap.

## Consequences

- A briefing generates today via one gated call to a real, audited,
  human-reviewed AI pipeline; a board pack assembles and PDF-renders in one
  call from live data, brand footer included, never auto-published.
- `north_metrics` changes are provably diffable from `core_audit_log` today —
  a future Metric Explorer needs no new tracking, only a query and a canvas.
- The chart canvas (and the separate approval/distribution lifecycle for
  board packs) is future work behind its own milestone: start from a failing
  Playwright spec against the Metric Explorer screen, per CLAUDE.md's
  outside-in TDD discipline, not from the chart code.
