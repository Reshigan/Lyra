# Revenue Lines Full Build — Design Spec

**Status:** approved, proceeding to plans.
**Scope:** implement full working engines for every revenue-line transaction
type graded PARTIAL/SEEDED-ONLY/DOC-ONLY in the 2026-08-16 revenue-line audit.
Five independent groups, each its own plan + subagent-driven-development run.

## Cross-cutting decisions

**D1 — F4 type names.** `PLAN-CREATE`/`PLAN-INSTALMENT` (docs/18) do not exist
in `packages/ledger/src/types.ts`. Resolution: add `PLAN-CREATE` as a new
non-financial (⊘) type (schedule write, no journal). Do not add
`PLAN-INSTALMENT` — reuse the existing `PREM-INSTALMENT` type for the
instalment leg, per docs/19 §5.2 E's own worked example.

**D2 — F3 `DPROD-RECOG`.** Does not exist anywhere. Resolution: no new type.
F3's money leg rides the existing F2 `SUB-INVOICE`/`SUB-RECOG` recipes with
`incomeAccount: "4060"` passed explicitly by the caller.

**Shared patterns every group reuses (no new pattern invented per group):**
- Gate-then-post: `gate(ctx, policyKey, subjectRef)` → `runTxn(ctx, {type, ..., preApproved: true})`, per `apps/api/src/engines/axis-endorse.ts`.
- Chained saga: two `runTxn` calls sharing one `parentTxnId`, per `axis-endorse.ts:120-165` (ENDORSE→REFUND-ISSUE).
- Batch lifecycle (draft→approve→pay→dispute→reopen): per `apps/api/src/engines/settlement.ts`, reused for any settle-later money.
- Precondition gates: `TXN_PRECONDITIONS[code]` in `packages/ledger/src/txn.ts:247-248`, checked before `openTxn` burns the idempotency key.
- Scheduled sweep: `apps/api/src/engines/sweep.ts`'s bounded-bite convention (ADR-0050) for any periodic/batch job.
- Recipe registration: new type = one `TXN_TYPES` row (`packages/ledger/src/types.ts`) + one `RECIPES` entry (`packages/ledger/src/recipes.ts`) if financial. Never a new branch in `runTxn`.
- Generic CRUD lockdown: once an engine owns writes to a resource, `apps/api/src/resources.ts` drops to read-only for that resource (matches existing `payments`/`settlements` pattern).
- Evals-first for any AI-touching piece (F5 only): author `packages/model-gateway/evals/<name>/{cases.jsonl,thresholds.json}` before writing the scoring prompt.

Every engine: tenancy via `withTenant`, audit row via `writeAudit` where model-gateway is touched, event emit `{module}.{noun}.{pastTenseVerb}` on completion, TDD (failing test first), contract test if a new route/OpenAPI surface is added.

---

## Group A — Accrual-only lines (C3, C5, C7)

**Types:** BIND-GROUP, FEE-BROK (C3) · REFERRAL-QUAL, REFERRAL-SETL (C5) · AD-PLACEMENT, DISCLOSURE-PRESENT (C7).

All reuse the existing `commissionAccrual`/`receivableSettlement` recipe builders — no new ledger math needed for any of these six types.

- **BIND-GROUP / FEE-BROK:** one engine (`apps/api/src/engines/group-commission.ts`) exposing `bindGroup()` and `brokerFee()`. Gate on `"axis.bind_group"` (existing approval key) → `runTxn(BIND-GROUP)`. FEE-BROK: no approval key registered today — gate skipped, direct `runTxn`, matching the type's own flag (financial, no policy key).
- **REFERRAL-QUAL → REFERRAL-SETL:** settlement-batch trio copied from `settlement.ts` — qualify (⊘, no journal) → settle (financial, `receivableSettlement`). New `apps/api/src/engines/referral-settlement.ts`.
- **AD-PLACEMENT gated on DISCLOSURE-PRESENT:** first live write to the `disclosures` table (`packages/db/src/schema/compliance.ts:52-69`) via a new route in `apps/api/src/routes/compliance.ts`. New `TXN_PRECONDITIONS["AD-PLACEMENT"]` entry in `txn.ts` requires a `disclosures` row for the same `subjectRef` newer than a policy-defined staleness window (24h) before `AD-PLACEMENT` posts — refused precondition does not burn the idempotency key (existing `runTxn` behavior).

Tests: dual-control test for BIND-GROUP mirroring `axis-claim-payment.test.ts`; precondition-refusal test for AD-PLACEMENT without a disclosure row; settlement-lifecycle test for REFERRAL-QUAL/SETL.

---

## Group B — Partner bind chain (C6, F1)

**Types:** PARTNER-BIND (existing, commission-accrual half only) + chained RSHARE-ACCR (existing `expenseAccrual` builder, currently only wired for AXIS's own revenue-share, not partner). F1 is C6 productised — same engine, exposed as the live path behind `orbit-partner-quotes.ts`'s currently-dead `requestPartnerQuote()`.

- Wire a real route (`apps/api/src/routes/orbit.ts`, new `POST /orbit/partners/:id/quotes`) calling `requestPartnerQuote()`.
- New `apps/api/src/engines/partner-bind.ts`: `bindPartner()` — gate → `runTxn(PARTNER-BIND)` → `runTxn(RSHARE-ACCR, {parentTxnId})` chained exactly like `axis-endorse.ts`'s ENDORSE→REFUND-ISSUE saga, using the existing `revshareFor()` helper (`orbit-partner-quotes.ts:35-43`) to compute the RSHARE-ACCR amount from `partner.revshareJson`.
- `quoterFor()` (`apps/api/src/routes/dist.ts:541-543`) stays a stub — out of scope (real rating integration is a separate, credential-gated line per `settlement.ts:43-46`'s precedent for PSP). Note this explicitly in the plan so no implementer tries to build a real quoting engine here.

Tests: chain test asserting both txns post under one `parentTxnId`; route contract test for the new quotes endpoint.

---

## Group C — Whitelabel billing + data products (F2, F3)

**Types:** SUB-INVOICE, SUB-RECOG, USAGE-METER (⊘), OVERAGE (F2) · DPROD-SUB (⊘), DPROD-DELIVER (⊘) (F3, per D2 reusing F2's money leg).

- New `apps/api/src/engines/billing.ts`: `recordUsage()` (posts `USAGE-METER`, ⊘) → monthly sweep (`apps/api/src/engines/sweep.ts` convention) raises `SUB-INVOICE`, applies `OVERAGE` if usage exceeds plan allowance → `SUB-RECOG` on a recognition schedule (existing `revenueRecognition` builder).
- F3: `DPROD-SUB` (⊘, subscribe to a data product) and `DPROD-DELIVER` (⊘, gated on a k-anonymity check — reuse `docs/19 §5.2 F`'s stated gate; refuse delivery if the aggregate query result set is below the k-threshold, precondition-style, not a new type). Money leg: caller invokes the same `SUB-INVOICE`/`SUB-RECOG` calls from `billing.ts` with `incomeAccount: "4060"`.
- Lock `revenue-schedules`/`usage-meters` resources (`apps/api/src/resources.ts:808-809`) to read-only once `billing.ts` owns writes.

Tests: sweep test asserting bounded-bite behavior (ADR-0050); k-anonymity refusal test for DPROD-DELIVER; income-account-4060 assertion for the F3 money path.

---

## Group D — Premium financing (F4)

**Types:** PLAN-CREATE (new, ⊘, per D1), PREM-INSTALMENT (existing, reused per D1), FIN-CMSN (existing), DUNNING (existing, ⊘).

- Add `PLAN-CREATE` row to `TXN_TYPES` (non-financial, no approval key — schedule write only, matches docs/19 §5.2 E's "no journal" note).
- New `apps/api/src/engines/premium-financing.ts`: `createPlan()` — writes `ledger_payment_plans` row (`packages/db/src/schema/ledger.ts:379-395`) via `runTxn(PLAN-CREATE)`, then `runTxn(FIN-CMSN)` chained via `parentTxnId` (Dr 1150/Cr 4080/Cr 2200 per docs/19 §5.2 E). `payInstalment()` — per-instalment `runTxn(PREM-INSTALMENT)` loop driven off `scheduleJson`.
- Dunning sweep (`sweep.ts` convention): on missed instalment, `runTxn(DUNNING)` (⊘); on N consecutive misses, cascades into the existing `/policies/:id/lapse` route (`apps/api/src/routes/axis.ts:1146-1156`) — reuse, no new cancel path.
- Lock `payment-plans` resource (`apps/api/src/resources.ts:815-819`) to read-only — currently wide open (`ledger:payments:create`) with no engine owning it; this is the one identified live gap where a client can write an arbitrary schedule/state directly today.

Tests: plan-create + chained FIN-CMSN test; instalment-loop test against `scheduleJson`; dunning-cascade-to-lapse test; regression test proving the generic resource route now rejects a direct write.

---

## Group E — Telematics/UBI (F5)

**Types:** TELEM-INGEST (new), UBI-REPRICE (new). Neither exists today — least-scaffolded line.

- Implement the existing but unused `TimeseriesIngest` seam (`packages/core/src/seams.ts:74-78`) with a concrete adapter (`apps/api/src/engines/telematics.ts`): `ingest(subjectRef, points)` posts `TELEM-INGEST` (⊘, stores raw points, no journal).
- `UBI-REPRICE`: new financial type. Reuses `axis-endorse.ts`'s `endorsePolicy`/`priceEndorsement` machinery directly, not new posting logic — telemetry-derived risk factors feed the existing ENDORSE path as an alternate pricing input.
- Evals-first: `packages/model-gateway/evals/ubi-reprice/{cases.jsonl,thresholds.json}` authored before any risk-scoring prompt is written, sibling shape to `axis-fraud`/`axis-reserve`.
- ADR note: this is the first real caller of `TimeseriesIngest` — document in ADR-0062 that the seam is now load-bearing (CLAUDE.md convention #15).

Tests: seam contract test for `TimeseriesIngest` implementation; endorsement-reuse test proving `UBI-REPRICE` posts through the same recipe as `ENDORSE`; eval harness test loading `ubi-reprice` cases/thresholds.

---

## Build order

A → B → C → D → E. Each group ships independently; no group blocks another except shared cross-cutting decisions (D1, D2) fixed above. Each gets its own plan under `docs/superpowers/plans/`, executed via `subagent-driven-development`, looped until all five are done.
