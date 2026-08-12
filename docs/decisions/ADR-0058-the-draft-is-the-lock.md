# ADR-0058 — The draft is the lock

Date: 2026-08-12
Status: Accepted
Context: docs/27 F7, docs/15 §4 (ambient AI grammar), CLAUDE.md rules 4 and 11

## Context

"AI drafts, a human approves" is the product's core claim, and both ends of the
loop were already built. `apps/web/app/routes/conversation.tsx` renders a
*trailing* `agent_ai` message with no `deliveryStatus` as a pending draft with
approve/discard, resolves its `ai_runs` row through `run.outputRef ===
draft.aiAuditId` to show the why, and approving re-posts the same text with
`deliveryStatus: "queued"`. The only thing that ever wrote such a row was
`packages/core/src/seed/orbit.ts`. The middle was missing: on a live
conversation the loop could not be closed at all.

## Decision

A scheduled sweep, `sweepConversationDrafts` in
`apps/api/src/engines/orbit-draft.ts`, drafts the next reply for every
conversation whose newest message is the customer's.

**1. The draft is its own idempotency key.** Only conversations whose newest
message is `role: "customer"` are drafted for. Writing the draft makes the
newest message `agent_ai`, so the next tick passes over it. No lock table, no
`drafted_at` column, no dedupe key — and by construction a conversation can
never hold two pending drafts, which is also the invariant the conversation
screen assumes when it renders "the" trailing draft.

**2. Context is assembled from the database, not fetched by a tool loop.** The
drafter makes exactly one `gateway.complete` call. The customer, their policies
and claims, and the last twelve messages are rendered as prose context lines
before the call. This is not a shortcut: the same lines are the input to
`verifyGroundedness`, so "did the model invent this number" is answerable. A
tool loop would leave the model's retrieved context unrecorded and the check
unanswerable.

**3. Groundedness is a runtime gate, not only an eval gate.** A reply quoting a
premium nobody quoted is worse than no reply, because a busy human approves
what reads plausibly. `verifyGroundedness` (`packages/core/src/narrator-verify.ts`,
already the AXIS copilot's check) runs on every draft; an ungrounded one is
recorded as a `refused` `ai_runs` row with its mismatches in `evidenceJson` and
never enters the inbox. The eval suite
`packages/model-gateway/evals/orbit-draft` scores the same function on seven
cases (en + ar, four clean, three violations) at `recallMin: 1.0`,
`falsePositiveMax: 0` — so the runtime gate and the eval gate are literally the
same code, and `evals/run.ts` names both consumers on the shared scorer.

**4. The agent row is the off switch.** The sweep resolves the seeded `service`
agent by key on every tick and returns 0 when it is missing or `status !==
"active"`. An operator turns drafting off from the agents screen, without a
deploy; a tenant seeded before the agent existed is skipped, not crashed —
which is why `findAgent` returns `null` where the request path's `agentByKey`
throws 404. Both now live in `apps/api/src/engines/ai-agent.ts`, moved verbatim
out of `routes/ai.ts`, because a scheduled tick has no request to hang a route
helper off.

**5. Draft only, never sent.** The inserted message carries no
`deliveryStatus`. That absence *is* the pending state; nothing in this path can
set `queued`. Rule 4 (an outbound send is consequential) and rule 11 (AI
arrives as a background draft, never a modal, never an auto-send) hold without
a special case.

## Consequences

- The tick position is deliberate: `sweepConversationDrafts` runs last among
  the non-nightly per-tenant sweeps, after `expireDelegations`. Drafting is the
  least critical job, so a failure there costs the least; a per-conversation
  `try` keeps one model failure from ending the batch.
- Bounded per tick: 25 non-closed conversations, newest first, none quiet for
  more than 7 days. A backlog drains over several ticks rather than in one
  spike, and a conversation that has gone quiet for a week gets archaeology,
  not service.
- `POST /v1/orbit/drafts/sweep` forces the sweep now, for demos and support. It
  requires both `orbit:ai:invoke` (it runs an agent) and
  `orbit:conversations:reply` (a draft lands in the transcript).
- The seeded prompt bans stating any premium, excess, date or reference not in
  the context, and bans claiming a message was sent, a payment taken or a
  change made. The groundedness check enforces the first half mechanically; the
  second half is prompt-level, and the human approval step is what makes that
  acceptable.

## Alternatives considered

**Draft on inbound, in `orbit-channel-inbound.ts`.** Lower latency, but it ties
drafting to the channel adapters and leaves every conversation that predates
the hook — and every message that arrived while the agent was paused —
permanently undrafted. The sweep picks those up on the next tick.

**Extract a shared `runAgent` from `routes/ai.ts`.** The request path runs a
tool loop with recall and a tool registry; the drafter needs one call over
DB-assembled context precisely so groundedness is checkable. Unifying them
would have meant either giving the sweep a tool loop it must not have, or
bending the request path around the sweep. Only the two lookups both genuinely
share (`findAgent`, `activePrompt`) were moved.
