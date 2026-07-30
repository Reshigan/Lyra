# ADR-0008 — Finance roles can invoke LEDGER agents but cannot report on them

- Status: **open — this is a question for the product owner, not a decision**
- Date: 2026-07-30
- Context: docs/06 §1 (roles), docs/15 §4 (ambient AI patterns), docs/19 §7
  (money movement separated from operations), ADR-0007

## Context

ADR-0007 records the grant rule at `packages/core/src/rbac.ts:200-204`:
`ai:suggestions:read` "rides with every `<module>:ai:invoke`", and "stops at
roles that only read finished artefacts (north.board) or only move money."

The finance roles are the "only move money" case, and the rule does stop there —
but they are not agent-free:

- `finance.analyst` holds `ledger:ai:invoke` literally
  (`packages/core/src/rbac.ts:413`).
- `finance.controller` holds `ledger:*:*` (`packages/core/src/rbac.ts:418`),
  which the segment-wise matcher (`packages/core/src/rbac.ts:466-472`) expands
  to cover `ledger:ai:invoke`.
- Neither holds `ai:suggestions:read`. They are the only two roles in `ROLES`
  that hold a `<module>:ai:invoke` and not the suggestion grant.

`POST /v1/ai/runs` gates on `` `${agent.module}:ai:invoke` ``
(`apps/api/src/routes/ai.ts:42`), so both roles can run a LEDGER agent today.
If a LEDGER agent ever renders an ambient surface — a reconciliation ghost
suggestion, a coding chip on a journal line, a forecast on a cash view — the
person seeing it cannot record that it was shown
(`apps/api/src/routes/ai.ts:175`) or that they accepted it
(`apps/api/src/routes/ai.ts:203`). Both calls 403.

The consequence is specific and quiet: `GET /v1/ai/suggestions/acceptance`
(`apps/api/src/routes/ai.ts:229-264`) would report LEDGER surfaces as having
been shown zero times. Not "poorly accepted" — *absent*. And by the rule's own
logic ("a surface nobody can measure is a surface that can never be retired"),
the one module where a bad AI suggestion moves money is the module with no
measurement.

**What is not yet true.** No LEDGER ambient surface is currently built.
`ledger:ai:invoke` appears in no code path outside
`packages/core/src/rbac.ts`; `apps/web/app/modules/ledger.ts` renders no AI
affordance. So this is a latent gap, not a live bug. It becomes live the day
someone ships the first LEDGER suggestion, and it will present as an empty
metric rather than an error.

## The question

Should `finance.analyst` and `finance.controller` hold `ai:suggestions:read`?

Three defensible answers, with what each actually costs:

**A. Grant it to both.** Two lines in `packages/core/src/rbac.ts` (:412-422).
The suggestion table carries `surface`, `module`, `userId`, `outcome`,
`editDistance`, `runId`, `subjectRef`, `contentRef` — no monetary amounts, no
journal references beyond an opaque `subjectRef`, so the read does not widen
what finance can see about money. It does widen what they can see about other
people's AI usage: the resource is tenant-scoped with no per-user filter
(`apps/api/src/resources.ts:407-410`), so a controller granted this could list
every user's suggestion history across every module. That is the real cost, and
it is a privacy question rather than a financial one.

**B. Grant it only when the first LEDGER surface ships.** Costs nothing now.
Risks the surface shipping with no telemetry and nobody noticing, because the
failure is a silent 403 inside a fire-and-forget instrumentation call, not a
broken screen.

**C. Leave it, and remove `ledger:ai:invoke` from the finance roles instead.**
Makes the rule true again in the other direction: roles that only move money get
no agents at all. This is the strictest reading of docs/19 §7's separation and
of docs/12's stance on money-affecting surfaces. It costs finance the LEDGER
agent entirely, which is likely too blunt — reconciliation assistance is a
plausible and valuable LEDGER agent.

There is a fourth possibility worth naming even though it is more work: if the
concern in **A** is cross-user visibility, the suggestion resource could be
scoped to `userId = actor` for non-admin roles, at which point granting finance
the read costs nothing at all. That is a change to
`apps/api/src/resources.ts:407-410` plus a scope filter, and it would improve the
grant for the other 19 roles too.

**Recommendation, stated as a recommendation:** A, with the cross-user
visibility question answered first — either accept it (finance already sees
audit-adjacent data) or add the per-user scope. Not applied here; no code was
changed.

## Consequences of leaving it open

- The rule comment at `packages/core/src/rbac.ts:200-204` currently describes
  finance as "only move money", which is not accurate — they can invoke agents.
  Whichever option is chosen, that comment needs a sentence.
- Nothing fails today, so the gap can persist indefinitely without pressure.
- If a LEDGER surface ships before this is answered, its acceptance rate will
  read 0% shown, and the natural conclusion from that number ("nobody uses it")
  will be wrong.
