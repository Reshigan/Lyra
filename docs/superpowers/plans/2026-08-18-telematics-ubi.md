# Telematics / UBI (Group E, F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Executed inline** in this session: subagent dispatch is unavailable (org monthly
> spend limit hit), so the controller implements each task itself. Task boundaries and
> the review gate at the end still apply.

**Goal:** make the `TimeseriesIngest` seam load-bearing with a real telematics adapter,
and let telemetry reprice a live contract through the existing endorsement machinery.

**Architecture:** two new transaction types. `TELEM-INGEST` (⊘, no journal) stores raw
points against a policy. `UBI-REPRICE` (financial) is a mid-term price change that runs
through `endorsePolicy` unchanged — same recipe builder, same approval gate, same version
append — so there is no second place in the codebase that knows how to price a contract.
The risk factors come from the model gateway and are eval-gated before the prompt exists.

**Tech Stack:** Drizzle (SQLite), Hono, `@lyra/ledger` `runTxn`/`buildRecipe`,
`@lyra/model-gateway`, vitest.

## Global Constraints

- Tenancy: every query through `scoped(ctx, table, …)`; every table has `tenant_id`.
- Model access only via `@lyra/model-gateway`; every call carries tenant, module,
  purpose, actor and lands in `ai_audit_log`.
- Money-affecting AI output is consequential: the reprice passes the `axis.endorse`
  approval gate. The model never writes a price directly.
- New transaction type = one `TXN_TYPES` row (+ a `RECIPES` entry only if it needs new
  lines). Never a new branch in `runTxn`.
- Evals-first: `packages/model-gateway/evals/ubi-reprice/{cases.jsonl,thresholds.json}`
  and a registered scorer exist and pass before the production prompt is written. An
  unregistered eval directory fails the gate by design (`evals/run.ts`).
- Migrations forward-only. **Check `packages/db/migrations/meta/_journal.json` before
  `pnpm db:generate`** — Groups C and D both claimed 0025/0026 and D paid the renumber
  tax. This branch sits on Group D's HEAD, so the next free number is 0028.
- Generic CRUD stays read-only for any resource an engine owns.
- Fx: every `runTxn` call site with a currency-dependent posting shape gets the
  `fxRateFor` pre-check plus a per-row `try`/`continue` in any sweep, from day one.
- No new industry nouns in UI strings or prompts beyond what the domain pack carries.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/seams.ts` | unchanged — H6's shape is the contract, not a suggestion |
| `packages/db/src/schema/axis.ts` | `axis_telemetry_points` table + dedup unique index |
| `packages/db/migrations/0028_*.sql` | generated |
| `packages/ledger/src/types.ts` | `TELEM-INGEST` (⊘), `UBI-REPRICE` (financial, `axis.endorse`) |
| `packages/model-gateway/src/ubi.ts` | `UbiContext`, `ubiSchema()`, `ubiMessages()`, `parseUbi()` |
| `packages/model-gateway/src/index.ts` | re-export |
| `packages/model-gateway/evals/ubi-reprice/cases.jsonl` | golden set: canned replies + ground truth |
| `packages/model-gateway/evals/ubi-reprice/thresholds.json` | gate values |
| `packages/model-gateway/evals/run.ts` | `scoreUbi` + `SCORERS["ubi-reprice"]` |
| `apps/api/src/engines/telematics.ts` | `TelematicsIngest` (seam impl), `aggregate()`, `repriceFromTelemetry()` |
| `apps/api/src/engines/axis-endorse.ts` | accept a transaction-type override; nothing else |
| `apps/api/src/routes/axis.ts` | `POST /policies/:id/telemetry`, `POST /policies/:id/reprice` |
| `packages/core/src/rbac.ts` | `axis:policies:telemetry`; reprice reuses `:endorse` |
| `apps/api/src/resources.ts` | `telemetry-points` read-only |
| `apps/api/src/openapi.ts` + `packages/sdk` | contract surface |
| `docs/decisions/ADR-0065-timeseries-ingest-is-load-bearing.md` | the seam decision |
| `apps/api/src/telematics.test.ts` | engine + route + seam-contract tests |

**Numbering note.** The spec says "document in ADR-0062". 0062 was taken by Group C
before this group started; 0065 is the free slot. Use 0065.

---

## Task 1 — Storage and the two transaction types

**Files:** `packages/db/src/schema/axis.ts`, `packages/ledger/src/types.ts`,
`packages/db/src/telemetry-points.test.ts`, `packages/ledger/src/types.test.ts`, migration.

`axis_telemetry_points`: `id`, `tenantId`, `subjectRef`, `source`, `at`, `value` (real),
`txnId`, `createdAt`.

Two indexes, and the unique one is the point of the task:

```ts
uniqueIndex("axis_telem_point_uq").on(t.tenantId, t.subjectRef, t.source, t.at),
index("axis_telem_subject_idx").on(t.tenantId, t.subjectRef, t.source, t.at)
```

A replayed ingest batch that double-counts kilometres reprices the contract wrong and
bills a customer for it. The transaction's idempotency key stops the *same* batch; the
unique index stops an overlapping one.

The seam carries `{at, value}` and no metric name, so `source` is the series key
(`"telematics:obd:km"`, `"telematics:obd:harsh_brake"`) — one adapter instance per series.
Widening H6 would need an ADR; it does not need widening.

- [ ] Failing test: schema test asserts the table, both indexes, and that a second insert
      at the same `(subjectRef, source, at)` throws.
- [ ] Failing test: `TXN_TYPES["TELEM-INGEST"]` is `financial: false`;
      `TXN_TYPES["UBI-REPRICE"]` is `financial: true, approval: "axis.endorse"`.
- [ ] Implement table + `TXN_TYPES` rows (lifecycle block, beside `ENDORSE`).
- [ ] `pnpm db:generate` — verify the journal numbers 0028 first.
- [ ] Tests green; commit.

## Task 2 — Evals before the prompt

**Files:** `packages/model-gateway/src/ubi.ts`, `evals/ubi-reprice/*`, `evals/run.ts`,
`packages/model-gateway/src/ubi.test.ts`.

`parseUbi(reply)` returns
`{ premiumDeltaPpm, factors: [{code, weight, evidenceRef}], droppedFactorCount, confidence }`.
Same discipline as `parseFraud`: **a factor with no `evidenceRef` is dropped, and a delta
with no surviving factor is zero.** An unexplained price change is not a price change — it
is the thing a regulator asks about.

Delta is in ppm of current premium, not minor units: the model reasons about "12% worse
than the book", not about cents, and the engine converts against the policy it holds.
Clamp to ±`MAX_REPRICE_PPM` (250_000 = 25%) — a model that returns 900% must not be able
to bill it.

`thresholds.json`:

```json
{
  "directionAccuracyMin": 0.9,
  "unexplainedFactorRateMax": 0.0
}
```

`directionAccuracy`: sign of `premiumDeltaPpm` matches the case's `expectDirection`.
**Superseded (commit `5f3a2ce`):** this plan originally specified a third threshold,
`maxDeltaPpmByProtectedProxy`, and called it the fairness gate. It was a tautology —
`parseUbi` never reads the proxy field, so the metric was zero by construction and could
not fail. docs/12 §4 excludes protected attributes at the *input* boundary (`UbiContext`
carries only series, totals, baselines and the window) and handles proxies through a
quarterly human audit; it defines no protected-attribute list, so a parser-level denylist
here would have meant inventing the classification. The pair invariant now lives as a
purity assertion in `packages/model-gateway/src/ubi.test.ts`, where it belongs, and this
line is not a fairness gate.

- [ ] Author `cases.jsonl` (≥10 cases: worse/better/neutral telemetry, a fence-wrapped
      reply, a reply with an unevidenced factor, a delta with an empty factor array, one
      protected-proxy pair) and `thresholds.json`. **Before** writing `ubiMessages`.
- [ ] Register `scoreUbi` in `SCORERS` — an unregistered directory fails the gate.
- [ ] Failing unit tests for `parseUbi`: fence stripping, drop-unevidenced,
      zero-without-factors, clamp, garbage-in-zero-out.
- [ ] Implement `ubi.ts` (`UbiContext`, `ubiSchema`, `ubiMessages`, `parseUbi`), export it.
- [ ] `pnpm eval` passes for `ubi-reprice`; unit tests green; commit.

## Task 3 — Ingest: the seam's first real implementation

**Files:** `apps/api/src/engines/telematics.ts`, `apps/api/src/telematics.test.ts`.

```ts
export class TelematicsIngest implements TimeseriesIngest {
  constructor(private ctx: Ctx, readonly source: string, private policy: AxisPolicyRow) {}
  async ingest(subjectRef: string, points: ReadonlyArray<{ at: number; value: number }>): Promise<void>
}
```

`ingest` opens one `TELEM-INGEST` txn keyed
`axis.telemetry:${subjectRef}:${source}:${batchHash}`, inserts the points with
`onConflictDoNothing()` against the unique index, then emits `axis.telemetry.ingested`
with the accepted count. No journal, no approval.

Points are refused before the txn opens if: empty array, `at` outside the policy term,
`value` non-finite or negative, or batch larger than `MAX_POINTS_PER_BATCH` (1000).
Route input is a trust boundary.

- [ ] Failing tests: happy path stores N points under one txn; replay of the same batch is
      a no-op and does not double-store; an overlapping batch stores only the new points;
      out-of-term and negative values are refused with no txn row; a `TELEM-INGEST` row
      never produces journal lines.
- [ ] Failing test tagged `@seam:H6`: `TelematicsIngest` satisfies `TimeseriesIngest`
      structurally and the points land — the seam's real contract test, beside the fake in
      `seams.test.ts`.
- [ ] Implement; tests green; commit.

## Task 4 — Reprice through the existing endorsement path

**Files:** `apps/api/src/engines/axis-endorse.ts`, `apps/api/src/engines/telematics.ts`,
`apps/api/src/telematics.test.ts`.

`endorsePolicy(ctx, policy, input, opts?: { type?: string })`, default `"ENDORSE"`.
`opts.type` sets the transaction type and the idempotency-key prefix. The recipe stays
`buildRecipe("ENDORSE", …)` / `buildRecipe("CMSN-CLAWBACK", …)` — the spec's "posts through
the same recipe as ENDORSE", literally.

`repriceFromTelemetry(ctx, policy, gateway)`:

1. `aggregate()` the policy's points per source over `[max(policy.startAt, last stamped
   ubi.windowEnd), now)`. Not the current version's window: a version boundary is where
   the price changed, not where pricing got up to — see ADR-0065 decision 5, which is
   binding here.
2. Refuse with `conflict` if there are no points — a reprice with no telemetry is a price
   change with no cause.
3. `gateway.complete(ctx, { module: "axis", purpose: "axis.policy.ubi_reprice",
   tier: "fast", messages: ubiMessages(context) })` then `parseUbi`.
4. Zero delta after clamping and factor-dropping: return `{ repriced: false }`. No txn, no
   version, nothing to approve.
5. `changes` keys are the factor codes. `priceEndorsement`'s existing `needsReferral` check
   refuses codes the product does not declare in `pricingInputsJson` — which is the H6
   seam's own documented purpose. A product that declares nothing constrains nothing, as
   today.
6. `endorsePolicy(ctx, policy, { changes, premiumMinor, reason: "ubi_reprice" },
   { type: "UBI-REPRICE" })`.
7. Stamp `aiAuditId` into the version's `termsJson.ubi` so the price is inspectable back to
   the model call (docs/15: every AI artifact carries its "why").

`premiumMinor = current.premiumMinor + round(current.premiumMinor * deltaPpm / 1e6)`,
floored at 0.

- [ ] Failing test: `UBI-REPRICE` posts the same journal lines `ENDORSE` posts for the same
      commission delta (assert line-for-line against `buildRecipe("ENDORSE", …)`).
- [ ] Failing test: the reprice passes the `axis.endorse` gate — with the key absent from
      `autoApprove` it raises an approval and posts nothing.
- [ ] Failing test: zero/unexplained model output writes no txn and no version.
- [ ] Failing test: a factor code outside the product's `pricingInputsJson` is refused as
      needing referral.
- [ ] Failing test: gateway failure is a refusal, not a silent zero-delta reprice.
- [ ] Failing test: `fxRateFor` pre-check — a policy currency with no rate to base refuses
      before the first write.
- [ ] Implement; tests green; commit.

## Task 5 — Routes, RBAC, CRUD lockdown, contract surface

**Files:** `apps/api/src/routes/axis.ts`, `packages/core/src/rbac.ts`,
`apps/api/src/resources.ts`, `apps/api/src/openapi.ts`, `packages/sdk/src/generated.ts`,
`apps/api/src/telematics.test.ts`, `apps/api/src/resources.test.ts`.

- `POST /v1/axis/policies/:id/telemetry` — `axis:policies:telemetry`, body
  `{ source, points }`, idempotency key defaults to the batch hash.
- `POST /v1/axis/policies/:id/reprice` — `axis:policies:endorse` reused: a mid-term price
  change is an endorsement, and a desk that may not endorse may not reprice. Key defaults
  to `axis_ubi_reprice:${policy.id}:${currentVersionId}:${newest}x${points}` — one reprice
  per exposure per retry storm. The key fingerprints the unpriced telemetry rather than the
  version: a run returning `repriced:false` has still billed a model call, so its key is
  kept, and only new telemetry mints a new one. It counts the points as well as dating them
  so an out-of-order backfill, which lands behind the newest instant, still moves the key.
  Both scalars are taken over `unpricedWindow` — the same half-open `[watermark, now)` the
  reprice itself prices, derived once and consumed by both. Ingest bounds a point by the
  term and the watermark, never by the clock, so a fast-clocked device stores future-dated
  points: a wider key bills a second model call for exposure the run ignores, a narrower one
  replays a stale no-op over a real price move once the clock catches up.
- `telemetry-points` resource: read-only (`axis:policies:read`), engine owns writes.
- `axis:policies:telemetry` granted to `axis.admin` and `axis.lead` beside `:finance`.

- [ ] Failing tests: both routes 403 without the permission; `POST` to
      `/v1/axis/telemetry-points` is a 404 (generic CRUD write refused); OpenAPI names both
      paths; the SDK regen is not stale.
- [ ] Implement; regen SDK; tests green; commit.

## Task 6 — ADR-0065 and docs

**Files:** `docs/decisions/ADR-0065-timeseries-ingest-is-load-bearing.md`,
`docs/handover/*` where behaviour diverges.

ADR records: H6 now has a production implementation, so its shape is frozen against
`TelematicsIngest`; `source` is the series key and why; the ppm-not-minor-units choice;
the clamp and its value; that `UBI-REPRICE` deliberately has no recipe of its own; and
that the spec's "ADR-0062" reference was already taken.

- [ ] Write the ADR.
- [ ] Handover pack: file 01 (system overview) gains the line; 07 (data and integrations)
      gains the telemetry source; 08 records any Minor findings left open.
- [ ] Commit.

## Task 7 — Whole-branch review

- [ ] Full verification: `pnpm typecheck`, then per-package `pnpm test` (the root turbo
      task is flaky under contention — verify per package), `pnpm eval`.
- [ ] Whole-branch review against `origin/main`. Independent-reviewer dispatch is blocked
      by the spend limit; if still blocked, note in the ledger that the review was
      self-administered, as Group D round 4 had to.
- [ ] Fix wave for Critical/Important; Minor findings to the ledger.
