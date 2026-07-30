# Module Spec — LYRA ORBIT (AI Customer & Partners)

"Every relationship, in orbit." ORBIT is the always-on layer between the
business and every customer and partner: agentic conversations in Arabic and
English, a renewal book that defends itself, and embedded-insurance APIs any
partner can integrate in a sprint. Standalone-sellable to any consumer brand
with a service book.

## 1. Personas

Customer (consumer) · CX Agent (human) · CX Team Lead · Retention Manager ·
Partner Manager · Partner Developer (external) · ORBIT Module Admin · Developer.

## 2. Capabilities

### 2.1 Agentic CX
- Channels: WhatsApp (Unifonic/Twilio), web chat widget (embeddable), voice
  (v1.1: telephony via partner SIP→ASR/TTS pipeline), email-in.
- Conversation runtime = `AgentRoom` Durable Object: streaming, tool calls,
  transcript, sentiment, language auto-detect (ar/en incl. Arabizi), context
  from customer 360.
- Tools available to the agent (registry-scoped): fetch policy, start quote
  (delegates to AXIS), endorsement request, document send/collect, renewal
  offer, FNOL guidance script (guide-only; never adjudicate), book callback,
  human handover.
- Handover: full-context transfer to human console (transcript summary,
  suggested next actions, customer mood). Human can whisper-ask the AI in a
  side channel.
- QA agent scores 100% of conversations (resolution, tone, compliance
  phrases); samples routed to Team Lead review; scores feed coaching.

### 2.2 Renewal defence
- Nightly Workflow scores expiring policies (churn model: features from spine
  + engagement) → strategy assignment (auto-requote / human list / suppress
  per consent).
- Auto-requote runs AXIS panel quote pre-expiry; one-tap renewal link (hosted
  page, tenant-branded); non-responders escalate per journey definition.
- Save desk view for humans: objection cards, price-match policy bounds
  (approval-gated), outcome logging with reasons.

### 2.3 Journeys (lifecycle orchestration)
- Visual journey builder (Admin): triggers (events/dates/segments), steps
  (message, wait, branch on reply/attribute, agent task, webhook), guardrails
  (quiet hours, frequency caps, consent checks baked in — cannot be removed).
- Library: welcome, doc-chase, renewal-90/60/30, win-back, NPS.

### 2.4 Partner & embedded platform
- Partner portal (external-facing, tenant-brandable): API keys, sandbox with
  mock quotes, docs, usage, revenue-share statements.
- Embedded flows: `POST /orbit/embedded/quotes` → ranked offers →
  `POST /orbit/embedded/binds` (delegates to AXIS) — webview drop-in and pure
  API modes; UTM/partner attribution automatic.
- Revenue-share ledger: per-txn calc, monthly settlement batches, statement
  PDFs, dispute flags.

## 3. Agents & automations

| Agent | Trigger | Tier | Consequential? |
|---|---|---|---|
| CX Agent | inbound msg | standard | sends within journey policy |
| QA Scorer | conversation closed | fast | no |
| Churn Scorer | nightly workflow | fast | no |
| Renewal Runner | schedule per policy | standard | offer send = policy-gated |
| Save Copilot | human opens save desk | standard | drafts only |
| Partner Sandbox Mock | sandbox calls | fast | no |

## 4. Screens

1. **Agent Console** — tri-pane: queue / conversation / customer 360 + copilot;
   canned+AI replies; handover controls; SLA + sentiment chips; RTL-perfect.
2. **Supervisor Wall** — live board: volumes, wait, AI-containment %, alerts;
   barge/whisper into any conversation.
3. **Renewal Book** — cohort table by expiry week; churn-band filters; strategy
   overrides; outcome funnel.
4. **Journey Builder** — canvas editor, versioning, simulate mode (dry-run a
   fake customer through), publish with diff review.
5. **Partner Portal** (external) — onboarding wizard, keys, sandbox console,
   usage & settlement.
6. **ORBIT Admin** — channels config (numbers, templates, webhooks from BSP),
   agent persona & tone editor per tenant/brand, tool enablement matrix,
   quiet-hours & frequency policy, QA rubric editor, handover routing rules.
7. **ORBIT Dev** — conversation simulator (scripted personas incl. Arabic),
   webhook tester, embedded-flow playground (renders the webview), API keys,
   transcript search (redaction-aware).

Mobile: Agent Console compact (respond, handover, approve sends), Renewal
alerts, Partner-manager stats. Customer-side mobile = tenant's own app via SDK
(chat widget RN component in packages/sdk).

## 5. Self-contained toolset

Channel connectors (WhatsApp BSP, webchat, email) · journey builder · persona
editor · QA rubric + coaching reports · partner portal · settlement statements
· CSAT/NPS collection · export (transcripts JSONL, redacted). Operates with
core spine only; if AXIS absent, quote/bind tools hide and ORBIT still runs
pure CX (this is the standalone CX sale).

## 6. Data / API / Events

Tables `orbit_*` · routes `/v1/orbit/*` + `/ws` · emits
`orbit.conversation.*`, `orbit.renewal.*`, `orbit.partner.txn`; consumes
`axis.policy.issued` (welcome journey), `axis.case.status_changed` (doc chase),
`signal.campaign.launched` (traffic surge staffing hint).

## 7. KPIs

AI containment % · first response < 5s (AI) / < 60s (human) · CSAT ≥ 4.5 ·
renewal retention +pts vs control · save-desk win rate · partner
time-to-first-bind < 4 weeks · consent violation count = 0 (hard alarm).

## 8. Acceptance criteria (v1)

- WhatsApp inbound in Arabic: quote → bind end-to-end with one human approval,
  transcript fully logged and QA-scored.
- Renewal cohort A/B (auto vs control) instrumented from day one.
- Partner sandbox → live key promotion without code changes.
- Frequency caps and consent checks unremovable in journey builder (test).
