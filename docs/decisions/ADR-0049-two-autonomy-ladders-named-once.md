# ADR-0049 — Two autonomy ladders, each named once

Status: accepted · 2026-08-11

## Context

"Autonomy" was written five ways across the platform, and no writer could see
any of the others:

| Where | Values |
| --- | --- |
| `packages/db/src/json.ts` `AutonomyLevel` (`PolicyJson.autonomyDefault`, SIGNAL campaigns) | `suggest, draft, act_with_approval, act, act_and_report` |
| `apps/api/src/routes/ai.ts` — `POST /v1/ai/agents/:key/autonomy` | `suggest, act_with_approval, act_within_limits, autonomous` |
| `apps/web/app/routes/ai-console.tsx` — hand-copied from the API | the same four |
| `packages/core/src/seams.ts` — the H2 envelope (docs/16) | `observe_only, act_with_approval, act_and_notify, act_autonomously` |
| the seed, writing `ai_agents.autonomy_level` | `suggest_only` ×9, `act_with_approval` |

`suggest_only` is on none of the four declared sets. The AI console therefore
rendered the raw key `suggest_only` in the Autonomy badge on nine of ten agent
cards, and the "Change autonomy" picker beneath each opened with nothing
selected — the stored value matched none of its options, so an operator could
not see what an agent was allowed to do and could not lower it without first
raising it. Recorded as docs/ui.md P2 defect 9 and docs/ui/admin.md §14
defect 2.

## Decision

There are two real ladders, not one, and each is now declared in exactly one
place.

**Agents** (`ai_agents.autonomy_level`) use `AGENT_AUTONOMY` in
`packages/db/src/json.ts`: `suggest → act_with_approval → act_within_limits →
autonomous`, ascending. The API validates against `AgentAutonomy` (the zod enum
over that list) instead of an inline literal, and `seams.ts`'s H2
`AutonomyEnvelope.level` is that same type — an envelope that named a
vocabulary of its own could never be compared against a stored level.

**Campaigns** (`signal_campaigns.autonomy_level`, and `PolicyJson.autonomyDefault`
which a transaction is stamped with) keep the five-rung ladder they already
have. It is internally consistent: SIGNAL's autopilot gates on its top two
rungs, the budget screen labels all five in both locales, and nothing renders a
raw key. Collapsing it onto the agent ladder would change what the autopilot is
allowed to do in order to fix a defect that does not exist there.

The seed now writes `suggest` where it wrote `suggest_only`. Rows already on
disk are read through `autonomyRung` in the console, which maps every spelling
written before the ladder was declared onto a rung and reads anything
unrecognised as the most cautious rung, never the freest.

## Consequences

- The seam's declared type changed, which CLAUDE.md rule 15 (docs/16) requires
  an ADR for. This is that ADR. No call site loses the seam: `AutonomyEnvelope`
  is unchanged in shape.
- No migration. Normalising on read covers rows written before this change and
  any written by an older deploy still in flight; `POST .../autonomy` and the
  seed both write canonical values from here on.
- A fifth spelling appearing in future is now a visible bug rather than a blank
  select: it renders as "Suggests only" and asks for confirmation on any raise
  off it.
