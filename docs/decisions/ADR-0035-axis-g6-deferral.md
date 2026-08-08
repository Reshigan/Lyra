# ADR-0035: Defer AXIS §G.6 Prioritiser/Chaser/Issuer agents

## Status

Accepted.

## Context

docs/specs/gap-axis-design.md §H task 16 closes out AXIS's AI surfaces
(fnol-triage, reserve, fraud, sla, and the §G.5 extraction set re-measured
from images — all five now have golden sets, thresholds, and passing evals
under `packages/model-gateway/evals/`). §G.6 names three further agents —
Prioritiser, Chaser, Issuer — that three already-committed files
(`packages/model-gateway/src/sla.ts:7`, `apps/api/src/engines/axis-sla-sentinel.ts:12-13`,
`apps/api/src/routes/axis.ts:378`) forward-reference as "ADR-0035 pending."
This ADR makes that deferral a decision instead of an open thread: task 16
closes with §G.6 out of scope, not silently dropped.

## Decision

**Defer all three agents; keep the SLA Sentinel as the load-bearing seam.**

Each of the three needs infrastructure that does not exist yet, and none of
that infrastructure is a byproduct of anything task 16 built:

- **Prioritiser** writes queue order. There is no queue-order table or
  read path for one — `axis-sla-sentinel.ts`'s `predictSlaBreach` only
  produces the breach estimate the Prioritiser would eventually rank on; it
  writes nothing (`axis_sla_*` does not exist as a table). Building the
  Prioritiser means building queue persistence first, which nothing else in
  §A-§G.5 needed.
- **Chaser** drafts consequential sends into "ORBIT's outbox." No outbox
  exists — ORBIT's draft-producer work is itself still open (F6/F7,
  tracked separately). The Chaser is blocked on that, not on model-gateway
  work.
- **Issuer** is the one place a model would touch `POST
  /v1/axis/policies/:id/bind` directly, gated through the same `gate()` a
  human faces with `actorKind: "agent"` on the transaction. This is the
  highest-stakes of the three — CLAUDE.md §4's human-in-the-loop rule and
  §12's transaction-integrity rule both apply — and it is the one where
  building the mechanism ahead of its eval (`evals/axis/issuer/`:
  `falseReadyRateMax: 0.0`, `readyRecallMin: 0.90`) would violate docs/13's
  "AI features are eval-first" rule for the highest-risk agent of the three.

None of the three has a golden set, an eval directory, or a consumer for
its output yet. Building them now would mean writing agent logic with no
failing eval demanding it — the opposite of docs/13 Development method
step 4. Task 16's scope is the AI surfaces that already had a caller
waiting (`predictSlaBreach` is called from `POST
/cases/:id/sla-predict` today); §G.6's three agents have no caller because
their consuming infrastructure (queue order, an outbox, an auto-approve
path with a real allowlist entry) isn't built. Deferred, not cut: §D.9's
`priorityScore`, the ORBIT outbox, and the bind auto-approval allowlist are
each independent prerequisites, and each unblocks exactly one of the three
agents — Prioritiser, Chaser, and Issuer respectively. Building any one of
them is a future task with its own golden set, not a continuation of task
16.

Alternative rejected: build the Prioritiser now since `priorityScore` (§D.9)
already exists as a board-ordering computation. Rejected because
`priorityScore` orders a UI read, not a persisted queue a Prioritiser writes
to — reusing the read path is not the same as building the write path an
agent needs to act on, and no eval exists to gate what the agent would add.

## References

- `docs/specs/gap-axis-design.md` §G.6 — the three agents' scope and eval
  thresholds (`spearmanVsExpertMin`, `groundednessMin`, `falseReadyRateMax`,
  `readyRecallMin`).
- `docs/specs/gap-axis-design.md` §H task 16 — the AI-surfaces task this
  ADR scopes out of.
- `packages/model-gateway/src/sla.ts:7` — Prioritiser/Chaser forward
  reference.
- `apps/api/src/engines/axis-sla-sentinel.ts:12-13` — same, with the
  outbox/queue infrastructure gap spelled out.
- `apps/api/src/routes/axis.ts:378` — same, at the route boundary.
- CLAUDE.md §4 (human-in-the-loop), §12 (transaction integrity) — why the
  Issuer specifically cannot be built ahead of its eval.
