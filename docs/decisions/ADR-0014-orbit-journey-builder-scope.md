# ADR-0014 — ORB-050 visual journey builder is out of scope for this go-live; ORB-051's frequency-cap floor is fixed instead

- Status: accepted
- Date: 2026-08-01
- Context: CLAUDE.md:4-6 (ambiguous spec → ADR), CLAUDE.md rule 15 (seams),
  docs/17-user-spec-benchmark.md:411-412 (ORB-050, ORB-051),
  docs/25-go-live-checklist.md M3 ORBIT v1 row,
  apps/api/src/engines/orbit-journeys.ts, orbit-journeys.test.ts

## Context

docs/17 lists two ORBIT M3 items:

```
| ORB-050 | Visual journey builder: triggers, waits, branches, messages, tasks, webhooks | M | M3 | T,D | ☐ |
| ORB-051 | Consent checks, quiet hours and frequency caps embedded and unremovable       | M | M3 | T   | ☐ |
```

An audit of `apps/api/src/engines/orbit-journeys.ts` found:

- `orbit_journeys` / `orbit_journey_runs` have full CRUD (generic resource
  registration, apps/api/src/resources.ts) and one real business-logic
  function, `triggerJourney`, which creates or restarts run rows.
- `graph_json` is freeform JSON (nodes/edges/cooldownDays) — a deliberate
  docs/16 seam, not a schema gap.
- `startNode` places a fresh run on the node after the trigger. Nothing else
  exists: no scheduler, tick, or executor ever advances a run past that first
  node through wait/branch/message/webhook nodes. `orbit_journey_runs.node`
  can change meaning only via a second call to `triggerJourney` itself
  (restart after cooldown), never via graph traversal.
- No UI exists for authoring or visualizing a graph; `graph_json` is
  hand-authored JSON today (see the `graph()` fixture in
  orbit-journeys.test.ts, and renewals.ts's `orbit.renewal.raised` event,
  which nothing currently consumes to call `triggerJourney`).

ORB-050 is therefore not a small gap — it is a full graph-execution engine
(a durable scheduler stepping runs through wait/branch/message/webhook nodes)
plus a drag-and-drop authoring UI. Building either this session, on top of
zero existing execution machinery, would be a multi-week feature disguised as
a checklist tick — exactly the kind of undersized fix CLAUDE.md's TDD process
(failing acceptance test first, outside-in) is meant to prevent from being
rushed in without its own milestone treatment.

ORB-051, by contrast, was a small, real, and fixable gap: `cooldownDays` was
optional and defaulted to no cap — the opposite of "unremovable" — with no
code change needed beyond `triggerJourney` itself.

## Decision

1. **ORB-051 (frequency caps unremovable) is fixed now, at the code level.**
   `triggerJourney` (apps/api/src/engines/orbit-journeys.ts) throws
   `badRequest` unless `graph.cooldownDays` is a positive number. The actual
   cooldown length stays the journey author's own policy choice — CLAUDE.md's
   guardrail against inventing regulatory claims rules out hard-coding a
   specific number nowhere specified in docs/12 — but declaring one is no
   longer optional. Covered by `orbit-journeys.test.ts`'s two new cases
   (missing field, and `cooldownDays: 0`), both asserting a 400.

2. **ORB-050 (visual journey builder + graph-execution engine) is deliberately
   deferred out of this go-live pass.** `triggerJourney` remains the only
   real journey behavior: create/restart a run on trigger, gated by consent
   and the now-mandatory cooldown. It does not walk a graph. This is a
   genuine, disproportionately large, undelivered gap, not a silently
   abandoned one — recorded here per CLAUDE.md rule 15 ("removing or
   bypassing a documented seam requires an ADR"; `graph_json`'s node/edge
   shape is exactly such a seam, built for but not yet driven by an executor).

3. docs/25-go-live-checklist.md's M3 ORBIT v1 row is updated to point here
   instead of carrying the frequency-cap gap as unscoped.

## Consequences

- A tenant can create a journey with a fully-populated multi-node graph
  (waits, branches, messages, webhooks) through the CRUD API today, but only
  the first message/task after the trigger will ever fire — every downstream
  node is inert until an executor exists. This must be communicated as a
  known limitation, not silently shipped as "journeys: done."
- The next milestone that picks this up should start the same way every
  other engine in this codebase did: a failing acceptance test
  (`@journey:J-C2`/`J-C3`-style, or a new J-ID) that exercises a run actually
  advancing past its first node, before any executor code is written.
- `renewals.ts`'s `orbit.renewal.raised` event has no consumer today; wiring
  it to `triggerJourney` is itself part of the deferred work, not a
  pre-existing regression from this ADR.
