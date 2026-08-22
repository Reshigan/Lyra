# ADR-0073 — The Command Center: a central AI loop that proposes, humans action

**Date:** 2026-08-22
**Status:** Accepted
**Supersedes:** nothing (new capability)
**Builds on:** ADR-0049 (autonomy vocabulary), docs/15 §4 (ambient AI grammar),
docs/27 F30/F39/F52, docs/02 §11 (seams)

## Context

LYRA's model-gateway discipline is real — every call is budgeted, scrubbed,
guardrailed and audited. But the register's verdict on the AI platform stands:
"correct gateway discipline; the loop above it is one tool round-trip."
Concretely:

1. **One round-trip.** `POST /v1/ai/runs` executes at most one batch of tool
   calls and stops (`apps/api/src/routes/ai.ts`). A task that needs
   read → read → act cannot be expressed.
2. **ORBIT-only tools.** The tool registry knows three ORBIT tools. NORTH,
   SIGNAL, SCOUT, LEDGER agents have no hands.
3. **No center.** Each module's AI is an island. Nothing observes across
   modules, proposes cross-module actions, or shows a tenant one surface where
   AI activity is legible.
4. **F39 stands.** `AutonomyEnvelope` is a declared seam with production reads
   but no envelope implementation; F52 — `VEC_MARKET` written, never read.

## Decision

Build the **Command Center**: one engine + one surface.

### 1. The orchestrator (`apps/api/src/engines/command-loop.ts`)

A bounded multi-step agent loop over a **unified tool registry**
(`command-tools.ts`) that composes per-module tool sets behind one interface.
Rules:

- **Bounded:** max 6 model rounds per run (configurable via agent row), then a
  forced summary round. No unbounded loops on a budgeted resource.
- **Propose → approve always.** Every consequential tool call does not execute;
  it becomes a **proposal** row (`core_proposals`, new table) carrying the
  policy key it would gate under, its args, and an inspectable "why" (the run's
  reasoning trace). Execution happens only through the existing approvals
  engine — `gate()` fires when the proposal is *actioned*, never at proposal
  time. Read-only tools execute inline as today.
- **AutonomyEnvelope implemented (closes F39):** the envelope decides whether a
  non-consequential tool auto-runs or also lands as a proposal, per tenant
  policy (`PolicyJson.commandCenter.autonomy`). Default envelope: level
  `draft_only`, reversible, everything consequential proposed.
- **Cross-module evaluation:** when a run names subjects in more than one
  module, the loop attaches a recall step over `VEC_MARKET` (first reader —
  closes F52) plus structured history joins (policies × conversations ×
  postings) so "evaluate the history with the new model attached" is a real
  query path, not prose.

### 2. The proposals table

`core_proposals`: id, tenant_id, run_id, module, tool_name, subject_ref,
policy_key (nullable — non-consequential proposals too), args_json, why_json,
state (`proposed|actioned|dismissed|expired`), created_by_run, decided fields.
Tenancy column mandatory. Proposals expire after APPROVAL_TTL_MS.

Actioning a proposal = the same route the desk uses for that action, invoked by
the Command Center UI with the proposal id — one execution path per action, not
a second one (the orbit-tools lesson).

### 3. The surface (`/center`, `apps/web/app/routes/command-center.tsx`)

Cinematic overview per user direction — but built from Constellation tokens and
the Horizon/Instrument layout language (ADR-0068), not a divergent system:
full-bleed dark canvas, module constellation map (SVG, per ADR-0053 — charts
are SVG in the kit, not a library), live proposal feed, run timeline with
per-round breakdown, ambient ✦ grammar on every AI artifact. i18n en+ar, RTL
logical properties, WCAG 2.2 AA.

### 4. What this does NOT change

- No new provider calls outside packages/model-gateway (CLAUDE.md rule 3).
- No auto-send, no modal AI (rule 11). Proposals are quiet rows, not popups.
- Approvals semantics untouched — `gate()` is the only door to consequence.
- ORBIT's existing single-round `/v1/ai/runs` behaviour unchanged; the loop is
  a new endpoint (`POST /v1/ai/command/runs`), not a rewrite of the old one.

## Consequences

- New table + migration (forward-only).
- New eval golden set before any prompt work (evals-first rule).
- The unified registry makes adding a module's tools a data-shaped change, not
  a route change.
- Risk accepted: proposal spam. Mitigated by per-agent daily proposal caps in
  the envelope (`maxActionsPerDay`) surfaced on the surface itself.
