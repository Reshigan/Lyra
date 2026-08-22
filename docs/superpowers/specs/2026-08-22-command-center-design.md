# Command Center — Design Spec

**Status:** approved (ADR-0073)
**Date:** 2026-08-22
**Method:** TDD. The acceptance suite below is committed failing first.

## Goal

One central AI loop that observes across modules, proposes actions through the
existing approvals engine, and one cinematic surface where a tenant sees all of
it. Modules stay standalone; when two share a tenant, cross-module evaluation
lights up.

## Acceptance criteria (the failing suite)

### A1 — Orchestrator engine (`apps/api/src/engines/command-loop.test.ts`)

1. **Multi-round:** a run whose first completion requests a read tool executes
   it and issues a second completion; the second round's text is the answer.
   Rounds are capped at 6 — a model that always asks for tools gets a forced
   summary round, not an infinite loop.
2. **Consequential → proposal:** a tool call with `consequential: true` never
   executes its handler. It writes a `core_proposals` row (state `proposed`,
   policy key, args, why) and the loop continues with a tool result saying
   `proposed:<id>`.
3. **Envelope gates reads too:** with autonomy level `draft_only`, only
   read-only tools auto-run; with `assist`, non-consequential writes
   (`start_quote`) also auto-run. Consequential tools propose under every
   envelope — no tenant setting may automate them (docs/19 §7 spirit).
4. **Cross-module recall:** a run whose input names subjects in two modules
   triggers a VEC_MARKET query (F52's first reader) and includes recalled
   context in the second round's messages.
5. **Audit:** every round is a separate gateway call carrying
   module/purpose/actor — each lands in ai_audit_log via the gateway's own
   write. Run row records total usage across rounds.

### A2 — Unified registry (`apps/api/src/engines/command-tools.test.ts`)

1. Composes ORBIT's three existing tools plus new read tools for AXIS cases,
   SIGNAL campaigns, SCOUT whitespaces, NORTH snapshots, LEDGER balances.
2. Every read tool checks the same permission the module's list route requires.
3. `toolsFor(agent)` filters by the agent row's allowlist like orbitToolsFor.

### A3 — Proposals API (`apps/api/src/routes/ai.ts` additions)

1. `GET /v1/ai/command/proposals` — pending proposals, permission
   `ai:command:read`.
2. `POST /v1/ai/command/proposals/:id/action` — re-invokes the action through
   the module's real endpoint path (engine function), so `gate()` fires once;
   409 if already actioned/dismissed/expired.
3. `POST /v1/ai/command/proposals/:id/dismiss` — audit + state change.

### A4 — Surface (`e2e/command-center.spec.ts`, `@journey:J-CENTER`)

1. `/center` renders: constellation map of modules with connection lines for
   modules that have shared subjects in the last 30 days, live proposal feed,
   recent runs timeline.
2. Each AI artifact carries the ✦ marker; "why" is inspectable (expandable).
3. Actioning a proposal from the surface routes through the approvals flow —
   an approval-required proposal shows the approval link, not silent success.
4. axe-clean, RTL-safe, en+ar keys present.

## Non-goals this slice

- Journey advancement (F30) — separate spec.
- Writing specs to OpenAPI/SDK regeneration — follows after route shape settles.
- Mobile parity — noted per DoD, follow-up.
