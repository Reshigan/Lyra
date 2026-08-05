# LYRA Go-Live Remediation — Master Sequencing Design

## Purpose

Single plan taking LYRA from current state (M2 AXIS closed per docs/14; M3-M6
marked CLOSED in docs/25-go-live-checklist.md but self-flagged as
memory-recall, not freshly re-verified, outside Core) through full-depth
remediation of the 52-finding platform audit
(`scratchpad/platform-audit-report.md`: 11 Critical, 30 Important, 11 Minor,
plus 5 cross-module Patterns) to go-live.

## Governing decisions (binding, made during brainstorming)

1. **Scope: fix everything before go-live.** All 52 findings close before
   shipping — Critical, Important, and Minor (including cosmetic/UX polish).
   No backlog deferral of any finding.
2. **Sequencing style: by module, fix-then-build.** Work proceeds module by
   module. Within each module: close that module's audit findings first,
   then build remaining roadmap work (docs/14, docs/25) on top.
3. **Module order: risk-weighted, shared-fix-first** (rationale below).
4. **Trust + triage stays in force throughout:** docs/25's claimed-CLOSED
   milestones are the baseline; the audit report is the correctness check.
   Real new gaps get fixed. Anything that contradicts a "CLOSED" row is
   flagged to the user for an explicit call — never silently decided.

## Module order and rationale

| # | Module / step | Why here |
|---|---|---|
| 1 | **ORBIT** | 6 screens fully built and unit-tested (`orbit-screens.test.ts`, 922 lines) but absent from both `apps/web/app/routes.ts` and `routing.ts`'s `HIDDEN_ROUTES` — unreachable in production. Cheapest fix in the whole audit (route registration only), highest value-per-effort, and directly contradicts docs/25's M3 "CLOSED" claim. |
| 2 | **Cross-cutting Criticals** | PII sealed-box encryption (`packages/core/src/pii.ts` has display-time masking only, confirmed by direct read — no field-level encryption exists anywhere; national ID stored as a one-way hash the code's own comment says "should not leave the API at all") and the SUCCESS-FEE snapshot-validation gap. Foundational: every later module's customer and money data sits on top of these. Also absorbs the cross-cutting Important eval gaps (docs/13 §3.3 ar/en scored-separately, §3.4 CX-quality LLM-judge) since they're genuinely cross-module, not owned by any one screen. |
| 3 | **Finance/Ledger** | Critical: a ledger mutation path with no compensating journal entry. Important: Money Map, Ledger Explorer, recon export/evidence bundle — all zero-implementation against docs/22 §1.1-1.4. Money integrity must be right before any later module builds more transaction volume on top of it. This pass also builds the shared ambient-AI-reasoning component (packages/ui) to close Finance's missing-AI-summary gap — first occurrence of the audit's "AI-no-why" Pattern in the module order, so it gets built once here and reused, not rebuilt per module. |
| 4 | **AXIS + Admin kill-switch tiers, together** | Same root cause surfaced as two separate audit findings: AXIS's `axis.admin` role lacks the pause permission/link, and Admin's kill-switch only implements the per-agent tier — module/tenant/global tiers don't exist at all. One task builds all 4 tiers; fixing AXIS's link alone without the missing tiers fixes nothing. |
| 5 | **Rest of AXIS** | Remaining Critical (AI copilot rendered in a modal — violates CLAUDE.md rule 11's ambient-AI grammar; reuses the shared component from step 3 instead of a second one-off fix) plus its Important findings. |
| 6 | **Rest of Admin** | Remaining Important findings (docs/09 §3 platform/tenant-admin capability gaps not covered by the kill-switch task). |
| 7 | **NORTH/SCOUT** | 2 Critical findings, plus Important. |
| 8 | **Core shell** | Critical: dead/unreachable search-results route. Important: `record.tsx` bare `confirm()`, onboarding `soft()` gaps. Comes after the modules that expose more of the shell's surface area, so fixes land against a fuller picture of what the shell actually needs to support. |
| 9 | **SIGNAL** | 1 Critical (lowest Critical density among the majors) plus Important/Minor, including reuse of the shared ambient-AI component for the compliance-approval rule-match visibility gap. |

Minor findings are fixed inside whichever module's pass owns them — there is
no separate "minor sweep" step, per the fix-everything / no-backlog decision.

## Cross-module Pattern handling

The audit names 5 recurring failure shapes hit by more than one module:
AI-action-with-no-inspectable-why, i18n/RTL leaks, silent truncation,
error-state conflation, and documented-but-unimplemented spec surfaces.

Rule: **first occurrence builds the shared fix, every later occurrence reuses
it.** The module pass that meets a Pattern first (per the order above) builds
a real component/helper (e.g. the ambient-AI-reasoning panel in
`packages/ui`, first built during the Finance pass) rather than a one-off
inline fix. Every subsequent module pass that hits the same Pattern is
required to reuse that shared piece and its task description must name which
earlier task built it — not re-solve the problem.

## Contradiction handling (Trust + triage, operationalized)

If a module pass discovers its docs/25 row is contradicted by what's
actually in the code (the ORBIT and PII cases below are already confirmed;
others may surface during later passes):

1. Stop before fixing.
2. Flag the contradiction to the user with the specific evidence (file,
   line, what docs/25 claims vs. what's true).
3. Get an explicit user call: fix now, or formally defer via a new ADR in
   `docs/decisions/`.
4. If fixed: update the docs/25 row in the same pass to reflect real
   re-verification, not memory recall.
5. If deferred: write the ADR before moving on, per CLAUDE.md's ADR
   convention (see ADR-0011 through ADR-0030 for the existing pattern).

Two contradictions are already confirmed and do not need re-discovery:

- **ORBIT**: docs/25 marks M3 ORBIT CLOSED (2026-08-01); `routes.ts` and
  `routing.ts` have zero entries for `orbit-console.tsx`, `orbit-save.tsx`,
  `orbit-pipeline.tsx`, `orbit-journey.tsx`, `orbit-quality.tsx`,
  `orbit-analytics.tsx`. User decision: fix (step 1 above), no ADR — this is
  a straightforward registration bug, not a scope call.
- **PII sealed-box**: docs/12 §1 specifies field-level encryption plus a
  daily hash-chained R2 audit anchor; `packages/core/src/pii.ts` has neither
  — only display-time masking. User decision: fix (step 2 above), no ADR.

## Per-module Definition of Done

Every module pass in the order above must complete all six before moving to
the next module:

1. That module's audit findings, Critical → Important → Minor, encoded as
   failing regression tests first (TDD, per CLAUDE.md's Development method).
2. Remaining roadmap build items for that module from docs/14/docs/25 not
   yet actually done (per the freshly-verified state, not the stale
   docs/25 claim).
3. The docs/25 checklist row for that module updated to reflect the fresh
   pass.
4. An eval case added under `packages/model-gateway/evals` if the pass
   touches AI/agent/prompt behavior (docs/13 gate).
5. OpenAPI updated in `packages/sdk` and regenerated if the pass changes any
   API surface; breaking changes versioned.
6. Audit log entries verified for any `consequential: true` action touched.

This is the existing CLAUDE.md "Definition of done (every PR)" section,
applied per module pass rather than only at the very end.

## Plan document structure (for writing-plans)

The implementation plan (next skill: `superpowers:writing-plans`) gets one
top-level section per module-order step above. Each section lists:

- Exact finding IDs/descriptions closed, sourced from
  `scratchpad/platform-audit-report.md` (the audit report is the source of
  truth for exact finding text — this design doc doesn't re-transcribe all
  52 findings).
- Shared components built in this step (if this step is a Pattern's first
  occurrence), and which later steps must reuse them.
- Remaining roadmap items completed in this step.
- Docs updated (docs/25 row, any new ADR).

No task in the plan may carry a "TBD" placeholder for a not-yet-discovered
contradiction — undiscovered contradictions are handled by the process in
"Contradiction handling" above, applied live during that module's pass, not
pre-written into the plan.

## Out of scope for this design

- The exact file-level task breakdown per module (file paths, test code,
  step-by-step diffs) — that's `writing-plans`'s job, working module by
  module from this order and from the audit report's exact finding text.
- Re-verifying docs/25 rows this design doc did not touch (Core platform
  admin/staff/back-office already got a fresh pass per docs/25 lines
  246-249) — those are trusted per the "Trust + triage" baseline decision
  and are not re-audited unless a later pass surfaces a contradiction.
