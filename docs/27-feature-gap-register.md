# 27 — Feature gap register (SME review, 2026-08)

Eight domain experts read the code as written, not the docs as promised:
market intelligence (SCOUT), admin/compliance, marketing (SIGNAL), insurance
operations (AXIS), Middle East market fit, customer service (ORBIT), AI
platform, and finance/ledger.

This register is the synthesis. It is a *findings* document, not a plan — each
P0/P1 needs an ADR or a spec update before it becomes work. Line references
were accurate at the commit that closed the go-live remediation program.

Findings that have since been fixed are marked *Closed* with what closed them,
so the register stays a record of what was found rather than being rewritten.
The P0 list was re-verified against the code on 2026-08-12; the verdict table
below is the original synthesis and is not updated as items close.

**One-line verdict per domain**

| Domain | Verdict |
| --- | --- |
| Finance/ledger | Real double-entry engine, no accounting department around it |
| AXIS | A document-and-case workbench with approval gates, not an insurance system |
| ORBIT | A console with no channels, no routing, and no confirmed AI draft producer |
| SCOUT | A good data model and labelling layer over almost no live intelligence |
| SIGNAL | Content generation without the publish loop it advertises |
| AI platform | Correct gateway discipline; the loop above it is one tool round-trip |
| Admin/compliance | The strongest area; gaps are depth, not absence |
| Middle East | Would win a technical evaluation, would not close against an incumbent |

---

## P0 — would fail in front of a paying customer

**F1. The ledger posting path is not atomic.** *Closed 2026-08-07 (`1093d7c`).*
`post()` now decides everything before it writes, assembles the header, the
lines, the balance upserts, the client-money check row and the transaction
stamp into one `Write[]`, and hands the set to `atomically()`
(`packages/db/src/tx.ts`) — the one capability D1 and libSQL share, so the
posting lands whole or not at all on both homes.

**F2. No manual journal.** Every line must come from a recipe keyed to a
business event; `TXN_TYPES` (`ledger/src/types.ts:58-160`) has no manual,
accrual, reclass, or opening-balance type. The approval policy
`ledger.manual_journal` already exists at `core/src/approvals.ts:51` and is
orphaned. No controller can operate without this.

**F3. No equity accounts, so no year-end close.** `AccountType` declares
`"equity"` (`db/src/chart-of-accounts.ts:6`); the chart contains no 3xxx rows.
`balanceSheet` (`ledger/src/reports.ts:369-392`) *derives* equity as a plug.
`closePeriod` only flips a status.

**F4. AXIS cannot bind.** *Closed.* `POST /v1/axis/quote-responses/:id/bind`
issues the policy from the selected panel response, under an idempotency key;
`api/src/axis-bind.test.ts` holds the replay and refusal cases.

**F5. AXIS has no endorsement, cancellation, lapse, or renewal.** *Closed.*
`axis_policy_versions` carries `versionSeq` and `endorsementNo`
(`schema/axis.ts:195-225`); `engines/axis-endorse.ts` prices and applies a
mid-term change and `engines/axis-lifecycle.ts` carries cancel, NTU, lapse,
reinstate and renew, with `sweepPolicyLifecycle` on the cron tick.

**F6. ORBIT has no inbound channel of any kind.** *Closed (ADR-0037/0038).*
`engines/orbit-channel-inbound.ts` takes signature-verified inbound over the
`Channel` adapter seam, with WhatsApp and Mailgun adapters
(`orbit-channel-whatsapp.ts`, `orbit-channel-mailgun.ts`) and an outbound
counterpart.

**F7. No confirmed producer of AI draft replies.** `conversation.tsx` renders a
trailing `agent_ai` draft and lets a human approve it, and `/v1/ai/runs` calls
a model with ORBIT's tool registry — but nothing *writes* that draft outside
`core/src/seed/orbit.ts`. No cron job, no inbound hook, no intent on the
conversation screen produces one. The "AI drafts, human approves" loop — the
product's core claim — still cannot be closed end to end on a live
conversation.

**F8. Production never configures the model gateway.** *Closed.*
`customerFacing` now comes from the purpose catalogue
(`model-gateway/src/purposes.ts`), which `gateway.ts:156` passes into the
guardrails, so `regulated_claim` blocks on every customer-facing purpose
without a per-tenant setting. `gatewayFor(env)` (`api/src/mw.ts`) passes the
provider bindings it actually has; model choice stays with
`ctx.policy.modelOverrides`.

**F9. Retrieval is tenant-scoped, not subject-scoped.** *Closed.*
`routes/ai.ts` filters recall on `{ tenantId, conversationId: subjectRef }`
and recalls nothing when there is no subject.

**F10. No eval exercises a model.** *Closed.* `evals/live.ts` holds the
live scorers, gated behind `LYRA_EVAL_LIVE=1` (`pnpm eval:live`) so CI stays
deterministic, and `run.ts` now fails — rather than skips — an eval directory
with no scorer registered.

**F11. SCOUT's cold-start Radar is broken by construction.**
`sweepWhitespace` inserts `clusterId: null`
(`engines/scout-whitespace.ts:131`) and `competitionScore: null` (`:136`);
`dots()` in `routes/scout.shared.ts:374` returns `[]` for exactly that shape.
A new tenant sees an empty Radar forever.

**F12. Three SCOUT routes are dead links.** *Closed 2026-08-12.* `/scout/pricing`,
`/scout/experiments`, `/scout/analytics` were linked from `scout-panel.tsx` and
`scout-radar.tsx` but not registered in `routes.ts`, stranding ~200 lines of
`scout.shared.ts`. All three screens are now built, registered, and listed in
the SCOUT workspace tools (`apps/web/app/modules/scout.ts`).

**F13. `axis_quotes` is written only by the seed.** *Closed.*
`dist_quote_responses` is now the single source of quote truth — the desk, the
bind path and the customer-facing comparison all read it, and
`api/src/axis-quotes-source.test.ts` holds that line.

---

## P1 — blocks a serious pilot

*Finance.* Premium accounting is cash-basis only — `1200 Premium Receivable`
appears once, as a chargeback default (`recipes.ts:296`), and `2000 Insurer
Payable` is never posted, so GWP is never a receivable (**F14**). Aging ages
journal lines by posting date against a free-text counterparty string, not open
items by due date, and there is no payables aging (`reports.ts:411-459`)
(**F15**). No cash application and no bank statement import — CAMT/MT940/OFX
absent; `ledger-recon.tsx:521` requires hand-pasted JSON (**F16**). Tax is a
caller-supplied `taxPpm` defaulting to zero (`core/src/commission.ts:45-58`)
while `docs/19` §5.3 says tax is never inferred; the `taxRules` table is unread
(**F17**). No FX revaluation of open balances (**F18**). Insurer statement
reconciliation posts nothing — `decideMatch` (`recon.ts:297-330`) updates match
state and never books the `CMSN-SETL` the spec promises (**F19**). `force: true`
on period close is accepted straight from the request body
(`routes/ledger.ts:187-195`) and `reopenPeriod` (`periods.ts:172-186`) has no
approval gate at all (**F20**). `SUCCESS-FEE` can post with no verified metric
snapshot despite `docs/19` §11.10 (**F21**). Four of the ten mandated property
obligations are untested, and the tests are seeded-LCG fuzz, not property tests
— fast-check is not a dependency (**F22**).

*AXIS.* Claims carry two money fields (`schema/axis.ts:227-252`); reserve is one
mutable integer overwritten in place (`claim-detail.tsx:452-460`), settlement
flips straight to `settled` (`:270-282`), and no claim-payment recipe exists
(**F23**). No coverage-in-force check at FNOL — `claim-detail.tsx:221` loads the
policy for display only (**F24**). Premium is a free-text integer with no
tax/fee split and no collection (`paymentPlanJson` is `// H9 reserved`)
(**F25**). No policy document generation; `axis-zero-touch.test.ts:217` concedes
it and substitutes an analytics PDF (**F26**). No state machine on policies or
claims (**F27**). Absent surfaces: FNOL intake, claims desk, endorsement wizard,
cancellation flow, renewal desk, underwriting referral desk, complaints
register, SIU queue (**F28**).

*ORBIT.* No routing or queueing engine — the only agent action is self-assign
(`orbit-console.tsx:267-282`); `LiveConversation.teamId` (`:45`) is never used;
`SLOW_MS` (`:66`) is a hardcoded 15 minutes that only recolours a badge
(**F29**). Journey execution never advances past the trigger —
`triggerJourney:84-165` writes a run at `startNode()` and nothing advances
`wait`/`send`/`branch`/`task` (**F30**). `ORBIT_TOOL_DEFS`
(`engines/orbit-tools.ts:14-57`) ships 3 of the 8 tools `docs/modules/orbit.md`
promises (**F31**). No KB/RAG article manager, no macros, no deflection
(**F32**).

*AI platform.* The agent loop is capped at one tool round-trip and the second
call is toolless (`routes/ai.ts:123-142`) (**F33**). `core_memories`
(`schema/core.ts:519-532`) is never read or written (**F34**). No streaming
anywhere, against `docs/15` §2 "streamed always" (**F35**). No cross-provider
fallback — `gateway.ts:110-119` retries the identical provider and model
(**F36**). Injection scanning covers only `role === "user"` (`gateway.ts:69-71`)
while tool results are pushed back as `{role: "tool"}`
(`orbit-tools.ts:238`), so indirect injection via tool output is unscreened
(**F37**). `consequential: true` is written to `ai_tool_calls`
(`orbit-tools.ts:229`) and nothing branches on it (**F38**). `autonomyLevel` has
zero production reads, three inconsistent enum vocabularies exist
(`core/src/seams.ts:39`, `routes/ai.ts:484`, `docs/16` L0–L3), and
`AutonomyEnvelope` (`seams.ts:40-45`) has no implementation — the doc-comment
at `:34-38` claiming enforcement is false (**F39**). `purpose` is
caller-controlled (`ai.ts:36`) and safety keys off it (**F40**). Guardrail
floors are six hard-coded English regexes with no Arabic
(`guardrails.ts:17-46`), contradicting `docs/16` H12 (**F41**).

*Middle East.* `localeFrom()` (`i18n.ts:138-140`) strips to the base subtag, so
`ar-SA` Eastern Arabic-Indic digits can never render (**F42**). Zero regional
payment rails — Telr, PayFort, PayTabs, Network International, mada, STC Pay,
Benefit Pay all absent (**F43**). KYC/national ID is a declared-but-empty
`IdentityVerifier` seam (ADR-0018) (**F44**). Takaful has schema and a
conditional card but no Shariah-board workflow or surplus distribution
(**F45**). Only cx-quality (5/10 Arabic) and axis (12/24) have Arabic eval
cases; north, compliance, injection, signal and axis-copilot have **zero** —
exactly the safety gates (**F46**). `docs/12:79` claims drift monitors sample
production weekly; nothing implements it (**F47**).

*NORTH.* The anomaly detector compares a period against the previous *write of
the same period* (`north-snapshotter.ts:305-336`), so day-grain anomalies never
fire and month-grain anomalies cry wolf at every month start (**F48**). NORTH's
financial metrics sum `axis_policies` directly (`:105-114`) and never read the
ledger, so the AI briefing narrates a figure that can never be tied to the
trial balance — and `verifyNumericClaims` then verifies the narrative against
that unverified source (**F49**). Two of eight specified screens exist; five API
routes; no scenarios, decisions, driver-decomposition or forecast endpoint
(**F50**).

*SCOUT.* No source ingestion, no live clustering
(`core/src/seed/scout.ts:31` is seed-only), no Bench Builder
(`resources.ts:485-491` seed-only), no competitor or regulatory watch
(**F51**). `VEC_MARKET` embeddings are written (`resources.ts:462-469`) and
never queried (**F52**).

---

## P2 — depth, not absence

Commission is flat-rate only — no ladders, tiers, volume bonuses or overrides
(`core/src/commission.ts:84-108`); clawback posts but nothing computes what is
clawable; no producer statements (`settlement.ts:39` serves partner, creator
and publisher, and explicitly refuses `insurer` at `:99-106`) — the remittance
advice at `:658-702` is good and simply pointed at the wrong kind. Period-close
checks are three deterministic tests with no subledger tie-out, no
recon-complete and no suspense check. Revenue schedules exist as data with
nothing driving them and no cap at invoiced. No bordereaux, inbound or outbound
— zero hits in code *or* docs. Chart of accounts is a hard-coded TypeScript
constant, so a tenant cannot add an account without a deploy. No budget vs
actual, no cash-flow statement, no fixed assets or operating-expense accounts.
Dead code in the money path: `closeRun` (`recon.ts:382-390`) has no callers,
`CREATOR-SPEND` (`recipes.ts:398`) has no matching `TXN_TYPES` entry and is
unreachable. `cx-judge.ts` is well-built and called by nothing. `K_FLOOR` is
hardcoded (`scout.shared.ts:40`). Only 2 of 6 SCOUT tables export
(`engines/report.ts:237,251`). No multimodal path (`extract.ts:7-9`). No AE-only
rulepack review, no Egypt/FRA pack. `packages/agents/` and `apps/agents/` do
not exist despite the CLAUDE.md target layout and `docs/02:59` — the runtime is
`api/src/engines/`.

**Thin screens.** `ledger-open-txn.tsx:79-120` asks a finance user to type
recipe arguments as raw JSON (the file's own header names the fix: publish the
recipe field list from `GET /txn-types`). `ledger-recon.tsx` cannot import a
file, close a run, write off a variance, or act in bulk. `ledger-account.tsx`,
`ledger-reports.tsx` and `ledger-money-map.tsx` export no action, so nothing
can be exported from the UI even though the API exports six reports.
`axis-board.tsx` has no transitions (self-documented at `:36-40`) and sorts by
lateness rather than value × risk × SLA. `axis-doc-intel.tsx` requires
caller-supplied `rawText` ("OCR is out of scope", `routes/axis.ts:73-78`).
`north-brief.tsx` owns an anomaly and nothing follows.

---

## What is genuinely strong

Worth protecting under any refactor, because these are the parts a buyer's
technical reviewer will test:

- **AI boundary discipline in the money path.** Recon pass 3 is opt-in
  (`routes/ledger.ts:586-616`, "no silent AI in the money path"); AI matches
  never auto-confirm (`recon.ts:145-294`, `AI_CONFIRM_FLOOR = 60`); the
  `MatchProposer` is injected so `packages/ledger` carries no model-gateway
  dependency and *cannot* call a model by accident.
- **Runtime dual control.** `approvals.ts:301-302` rejects an approver equal to
  the initiator; the gate fails closed on unstated amounts (`:164-170`);
  `txn.ts:263-265` refuses to honour an `auto_approve` entry for a payout or
  client-money type.
- **Client-money segregation.** `posting.ts:319-351` asserts `1010 ≥ 2010` and
  persists a check row on every post, throwing on shortfall.
- **Single write path.** `routes/ledger.ts:49-52` — no endpoint writes a journal
  line directly, and the type/recipe mapping is enforced bidirectionally
  (`txn.ts:249-254`). No counterexample found.
- **Settlement staleness guard.** `settlement.ts:426-434` refuses to approve a
  settlement whose totals moved since drafting.
- **Server-side tool re-validation.** `executeOrbitToolCalls`
  (`orbit-tools.ts:189-239`) re-checks every model-requested call against the
  allow-list and converts `approval_required` into a tool result.
- **Gateway order of operations** — scrub before hash, kill before budget, audit
  on every terminal state, hashes only — and `verifyNumericClaims` /
  `verifyGroundedness` shared verbatim between production and evals
  (`core/src/narrator-verify.ts:91,107`).
- **RTL is real.** Zero physical-direction CSS across `apps/web/app/**` and
  `packages/ui/src/**`; `dirFor()`/`langFor()` (`i18n.ts:59-80`); a bilingual
  `KIT_TEXT` in the kit itself; Hijri as a first-class `CalendarPreference` with
  a golden test (`ui.test.ts:359`).
- **k-anonymity suppression** (`core/src/k-anonymity.ts:17-19`), evidence
  bundles with manifest + sha256 + R2 (`routes/ledger.ts:706-833`,
  `routes/compliance.ts:204-310`), PII sealing with audited reveal
  (`routes/axis.ts:174`), and `EvidenceLink` + `AgentBadge why=` on every AI
  surface checked.

---

## Suggested order

F1, F4, F5, F6, F8, F9, F10, F12 and F13 are closed; what is left of P0, in
order:

1. **F7** (a real draft producer) — the ORBIT claim. The consumer exists on
   both ends; nothing writes the draft.
2. **F11** — a new tenant's Radar is empty forever, and it is a two-field fix.
3. **F2, F3** (manual journals, equity) — the accounting department. Opening
   balances need the 3xxx accounts, so these go together.

Every item above is a finding, not an approved change. P0s that alter a
documented seam or add a third-party service need an ADR first.
