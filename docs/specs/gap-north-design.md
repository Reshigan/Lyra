# NORTH — implementation design (gap closure F48 / F49 / F50 / P2 / F46-north)

Status: design, not built. Nothing in here is code yet.
Owner: NORTH. Companion specs: `docs/specs/gap-orbit-design.md`,
`docs/specs/gap-signal-design.md`.
Source of truth for behaviour: `docs/modules/north.md`. Where this spec and
that module doc disagree, the module doc wins and this file is wrong.

This closes five register entries:

| ID | One line | Register |
|----|----------|----------|
| F48 | The anomaly detector compares a period against the previous *write of the same period*. | `docs/27-feature-gap-register.md:186-194` |
| F49 | Financial metrics sum `axis_policies` and never read the ledger. | `docs/27-feature-gap-register.md:186-194` |
| F50 | 2 of 8 screens, 5 API routes, no scenarios / decisions / driver decomposition / forecast. | `docs/27-feature-gap-register.md:186-194` |
| P2 | `north-brief.tsx` lets an exec own an anomaly and then nothing follows. | `docs/27-feature-gap-register.md:235` |
| F46-north | NORTH has ten eval cases and zero of them are Arabic. | `docs/27-feature-gap-register.md:181-183` |

---

## 0. What actually exists today (the ground this stands on)

Every row below was read, not inferred.

| Fact | Location |
|------|----------|
| Eight `north_*` tables exist, all eight registered in the generic CRUD registry. | `packages/db/src/schema/north.ts:1-158`, `apps/api/src/resources.ts:520-548` |
| `north_scenarios` and `north_decisions` exist with **no engine, no bespoke route and no screen** behind them. | `packages/db/src/schema/north.ts:87-102`, `:140-157` |
| The API has exactly **five** bespoke NORTH routes. | `apps/api/src/routes/north.ts:31, 52, 110, 125, 145` |
| The web app has exactly **one** registered NORTH route. | `apps/web/app/routes.ts:57` |
| Four links on that one screen point at routes that do not exist: `/north/board`, `/north/whatif`, `/north/anomalies/:id`, `/north/metrics?q=`. | `apps/web/app/routes/north-brief.tsx:363, 370, 459, 487` |
| The snapshotter computes ten metrics on two periods: yesterday (day) and month-to-date (month). | `apps/api/src/engines/north-snapshotter.ts:30-37`, `:196-207` |
| `gwp` sums `axis_policies.premium_minor`. `net_commission` sums `axis_policies.commission_minor`. Neither reads a journal line. | `apps/api/src/engines/north-snapshotter.ts:105-113`, `:115-123` |
| The anomaly baseline is the value that was in the **same** `(tenant, metricKey, grain, period, dimsHash)` row before this run overwrote it. | `apps/api/src/engines/north-snapshotter.ts:261-272` (lookup) → `:305` (`const prevValue = existing?.value`) |
| The anomaly threshold is a flat 500 bp for percent/ratio metrics, 1 500 bp for everything else. No variance, no season. | `apps/api/src/engines/north-snapshotter.ts:210-212` |
| The narrator, in the same codebase, does the **correct** prior-period comparison (`previousDay` / `previousMonth`). | `apps/api/src/engines/narrator.ts:83-88` |
| Every numeric claim in a briefing is machine-checked against the snapshot before the briefing leaves `draft`. | `apps/api/src/engines/narrator.ts:167-225`, `packages/core/src/narrator-verify.ts:91-95` |
| `verifyNumericClaims` extracts numbers with `/\d[\d,]*(?:\.\d+)?/g` — ASCII digits only. | `packages/core/src/narrator-verify.ts:47` |
| Eighteen `north:*` permission keys are already declared. Several are declared and unwired. | `packages/core/src/rbac.ts:139-146` |
| Four NORTH roles already exist: `north.exec`, `north.analyst`, `north.board`, `north.admin`. | `packages/core/src/rbac.ts:425-455` |
| `readsOf("north")` auto-grants every `north:*:read` key to `north.exec` and `north.analyst`. | `packages/core/src/rbac.ts:210-212`, `:427`, `:438` |
| `north_metrics.sensitivity` (`public|internal|restricted`) exists in the schema and is seeded (`loss_ratio` = `restricted`) and **enforced nowhere**. | `packages/db/src/schema/north.ts:20`, `packages/core/src/seed.ts:1120-1244` |
| The double-entry ledger already exposes `trialBalance`, `profitAndLoss`, `balanceSheet`, `agedBalances`, `clientMoneyPosition`, `commissionByDimension`, all returning ledger-derived figures. | `packages/ledger/src/reports.ts:40, 188, 339, 369, 411, 475` |
| `ReportTable` is the one export shape the PDF renderer knows. | `packages/ledger/src/reports.ts:510-516`, consumed at `apps/api/src/routes/north.ts:58` |
| The seeded December snapshots include five channel splits and five provider splits that **sum exactly to the December total**. | `packages/core/src/seed.ts:1263+` (`DECEMBER_SPLITS`) |
| `docs/04-api.md:80` declares `north.anomaly.detected` and `north.briefing.published`. The only NORTH event actually emitted is `north.alert.triggered`. | `apps/api/src/engines/north-snapshotter.ts:298` |
| `packages/model-gateway/evals/north/` exists: 10 cases, `scoreNorth` registered. | `packages/model-gateway/evals/run.ts:233-246`, `:309` |
| All 10 of those cases are English. | `packages/model-gateway/evals/north/cases.jsonl` |

**Correction to the brief that commissioned this spec.** It says NORTH has zero
eval cases. It has ten, and a registered scorer. What it has zero of is Arabic
cases, and the scorer never calls a model — it scores a pure function
(`verifyNumericClaims`) against fixtures. Both of those are real gaps and are
closed in §M; "no eval directory" is not.

---

## A. Scope, non-goals, and the shape of the fix

### A.1 What this design adds

1. A **closed-period rule** for snapshots, which is the actual fix for F48.
2. Three named **baseline methods** (prior period, same period last year,
   seasonal robust-z) chosen per metric per grain, with the chosen method and
   its inputs stored on the anomaly row.
3. A **ledger tie-out** — every money metric is either ledger-derived or is
   labelled operational and barred from board and investor surfaces, with a
   nightly recorded reconciliation either way. That is F49.
4. **Driver decomposition** as an explicit formula tree with exact Shapley
   attribution and a zero-residual property test.
5. A **forecast** with a named, inspectable algorithm, stored parameters,
   empirical prediction intervals, immutable versioned runs, and
   actuals-vs-forecast variance attributed back down the same driver tree.
6. **Scenarios** as a fork of a forecast run that structurally cannot write to
   the actuals path.
7. The **anomaly → decision → outcome** loop, with approvals, an append-only
   decision event log, and a review nag. That is P2.
8. The **six missing screens** and the routes behind them. That is F50.
9. Arabic eval coverage above 40%, an anomaly-explainer eval, and a tie-out
   eval that would actually have caught F49. That is F46-north.

### A.2 Non-goals

- **No new BI query language and no client-supplied SQL.** `/explore` already
  refuses that (`apps/api/src/routes/north.ts:122-124`) and this design keeps
  the refusal. Every read goes through the semantic layer.
- **No `week` grain.** Nothing writes week snapshots today
  (`north-snapshotter.ts:30-37`) and `narrator.ts:77` explicitly skips it. This
  design narrows the `/explore` enum to match reality rather than pretend
  (task T24). Adding week grain later is a snapshotter change, not a schema
  change.
- **`loss_ratio` and `renewal_retention_rate` stay uncomputed.** ADR-0024
  already decided that; `north-snapshotter.ts:191-195` documents it. They stay
  seeded definitions with no compute, and the data-health screen shows them as
  never-snapshotted rather than hiding them.
- **No new BI vendor, no charting service.** docs/20 self-sufficiency. Charts
  are SVG rendered from the same snapshot rows.
- **No ML.** The forecast is a damped Holt method with explicit parameters. A
  CFO can reproduce it in a spreadsheet, which is the requirement.

### A.3 Constraints this design is bound by

Pulled from `CLAUDE.md` because each one changes a concrete decision below:

- §1 tenancy — every new table carries `tenant_id`; every read goes through
  `withTenant`.
- §3 model access only via `packages/model-gateway` — the anomaly explainer and
  the scenario narrator are gateway calls with `module: "north"` and a
  `purpose`, never a provider SDK.
- §4 human-in-the-loop — committing a decision is consequential (§J.4).
- §6 events over calls — NORTH consumes other modules through the bus and
  emits `north.anomaly.detected` / `north.briefing.published`, which
  `docs/04-api.md:80` has been promising since before any of this existed.
- §7 RTL + i18n — all eight screens, and the board pack, and the Arabic
  briefing, and `NUMBER_RE`.
- §11 ambient AI grammar — the anomaly explanation is a quiet chip with an
  inspectable "why", not a modal.
- §12 transaction integrity — a decision that moves money does not move money
  itself; it hands off to the module that owns the transaction.
- §14 domain-pack vocabulary — `narrator.ts:132-135`'s hard-coded English
  prompt with insurance nouns is a §14 violation today and is rewritten.
- §15 build to the seams — the baseline method, the forecast method and the
  driver tree are each an interface with a registry, because "seasonal-aware
  per-metric baselines" (`docs/modules/north.md` §2.3) means the metric picks
  the method.

---

## B. Role design

### B.1 The rule: zero new roles

The four seeded NORTH roles at `packages/core/src/rbac.ts:425-455` are the
right four. An executive-intelligence module with a fifth role is a module
nobody can administer. Everything below reuses them.

### B.2 Permission keys that already exist and are already declared

`packages/core/src/rbac.ts:139-146` declares eighteen keys. Their status:

| Key | Wired today | Where | This design |
|-----|-------------|-------|-------------|
| `north:metrics:read` | yes | `routes/north.ts:147` (`/data-health`), CRUD read | reused; gains `rowVisible` sensitivity gate |
| `north:metrics:write` | yes (generic CRUD) | `resources.ts:521` | reused; gains a version-append side effect |
| `north:snapshots:read` | yes | `routes/north.ts:127` (`/explore`) | reused; gains `rowVisible` dimension scoping |
| `north:snapshots:run` | yes | `routes/north.ts:112` | reused; also gates the backfill route |
| `north:briefings:read` | yes | `resources.ts:531` | reused |
| `north:briefings:generate` | yes | `routes/north.ts:33` | reused |
| `north:briefings:approve` | yes | `resources.ts:532` (update) | reused; becomes the publish gate |
| `north:anomalies:read` | yes | `resources.ts:536` | reused |
| `north:anomalies:assign` | yes | `resources.ts:537` (update) | reused; also gates `POST /anomalies/:id/decision` |
| `north:scenarios:read` | **declared, no surface** | `resources.ts:541` only | wired in §I |
| `north:scenarios:run` | **declared, no engine** | `resources.ts:542-543` | wired in §I |
| `north:boardpacks:read` | yes | `resources.ts:546` | reused |
| `north:boardpacks:generate` | yes | `routes/north.ts:54` | reused |
| `north:decisions:read` | yes | `resources.ts:545` | reused |
| `north:decisions:write` | **declared, no loop** | `resources.ts:545` (`rw`) | narrowed in §J.2 to create + transition |
| `north:alerts:read` | yes | `resources.ts:546` | reused |
| `north:alerts:write` | **declared, unused by any engine** | `resources.ts:546` | reused; alert rules become editable from NORTH Admin |
| `north:ai:invoke` | yes | `rbac.ts:162` | reused by the anomaly explainer |

Four keys are declared-but-unwired today: `north:scenarios:read`,
`north:scenarios:run`, `north:decisions:write` (declared but with nothing that
completes a loop), `north:alerts:write`. This design consumes all four.

### B.3 New permission keys — three, and why each is not a reuse

Added to the closed `PERMISSIONS` array which currently ends at
`packages/core/src/rbac.ts:203`.

| New key | Why not reuse |
|---------|---------------|
| `north:forecasts:read` | A forecast is a forward-looking number with a company-level implication. `north:snapshots:read` covers recorded fact; conflating the two would mean anyone who can read yesterday's policy count can also read next quarter's projected commission, which is a materially different disclosure. |
| `north:forecasts:run` | Running a forecast writes an immutable versioned run that supersedes the previous one and becomes the base every scenario forks from. `north:scenarios:run` is a sandbox permission — a scenario cannot affect anyone else's numbers; a forecast run changes the number the board sees. |
| `north:decisions:approve` | `approvals.ts` requires a `decide` permission distinct from the permission that raises the request, or dual control is theatre. `dist.agreement_sign` at `approvals.ts` makes the same argument in a comment: "the person who drafted them cannot be the one who signs". `north:decisions:write` raises; `north:decisions:approve` commits. |

`readsOf("north")` at `rbac.ts:210-212` filters the catalogue for keys ending
`:read`, so adding `north:forecasts:read` **automatically** grants it to
`north.exec` (`:427`) and `north.analyst` (`:438`), to `tenant.admin` via
`north:*:read` (`:244`), and to `north.admin` via `north:*:*` (`:454`). It does
**not** reach `north.board`, whose grant is an explicit list at `:450`. That is
the correct default and it is deliberate: see B.4.

### B.4 Who gets what

| Role | Forecast read | Forecast run | Scenario run | Decision write | Decision approve | Restricted metrics |
|------|---------------|--------------|--------------|----------------|------------------|--------------------|
| `north.exec` (`rbac.ts:425-431`) | yes (auto via `readsOf`) | **yes — add explicitly** | yes (already) | yes (already) | **no** | yes |
| `north.analyst` (`rbac.ts:436-441`) | yes (auto) | **yes — add explicitly** | yes (already) | no | no | yes |
| `north.board` (`rbac.ts:448-452`) | **yes — add explicitly** | no | no | no | **yes — add explicitly** | no |
| `north.admin` (`rbac.ts:453-455`) | via `north:*:*` | via `north:*:*` | via `north:*:*` | via `north:*:*` | via `north:*:*` | yes |
| `tenant.admin` (`rbac.ts:244`) | via `north:*:read` | no | no | no | no | no (see B.5) |

Three deliberate calls, each of which will look wrong to somebody:

1. **`north.board` gets `north:decisions:approve` and `north.exec` does not.**
   The exec raises the decision; a board member commits it. That is the whole
   point of the separation, and it means the seeded `north.board` role stops
   being read-only. `rbac.ts:449` carries the comment "never grant write here".
   `north:decisions:approve` is not a write to the decision row — approval
   lands in the approvals tables, and the decision row transition is executed
   by the requester after the gate passes. The comment survives intact; task
   T18 asserts `north.board` still holds no `north:*:write`-shaped key.
2. **`north.board` gets `north:forecasts:read` but not `north:snapshots:read`
   beyond what it already has.** A board member sees the projection and the
   pack, not the raw operational drill-down. That matches `rbac.ts:450`'s
   existing shape.
3. **`tenant.admin` reads everything via the `north:*:read` wildcard at
   `rbac.ts:244`, including forecasts.** That is pre-existing and this design
   does not widen it, but it does *narrow* it: see B.5.

### B.5 Row-level scoping — executive data is not uniformly readable

Two independent scopes, both implemented with machinery that already exists.

**Scope 1 — metric sensitivity.** `north_metrics.sensitivity` is
`public|internal|restricted` (`schema/north.ts:20`), seeded with `loss_ratio`
as `restricted` (`seed.ts:1120-1244`), and enforced by nothing. Add a
`rowVisible` predicate to the `metrics` and `snapshots` resources in
`resources.ts`, exactly the idiom `scout.data_products` already uses at
`resources.ts:505-518`:

```
rowVisible: (ctx, row) =>
  sensitivityOf(row) !== "restricted" ||
  can(ctx.actor, "north:metrics:write", { tenantId: ctx.tenantId, module: "north" })
```

`crud.ts` renders a hidden row as **404, never 403** — the fact that a
restricted metric exists is itself restricted. `north.exec`, `north.analyst`
and `north.admin` hold `north:metrics:write` or the wildcard; `north.board`
and `tenant.admin` do not, so a loss ratio does not appear in a board list or
an admin console until somebody deliberately declassifies it. For snapshots the
predicate needs the metric's sensitivity, which is a second read — so the
snapshot resource resolves it from a per-request cache of
`north_metrics.key → sensitivity` built once in `beforeWrite`/loader scope
rather than per row.

**Scope 2 — dimension scoping (team / branch / producer).** `Scope` already
carries `teamIds` and `productLines` (`rbac.ts:8-15`) and `scopeAllows` at
`rbac.ts:530-537` already **fails closed** on a subject with no team. Snapshot
rows carry `dimsJson` and a readable `dimsHash` of the form `k=v&k=v`
(`seed.ts:1263+`). So:

```
rowVisible: (ctx, row) => {
  const dims = parse(row.dimsJson);
  if (!dims.team && !dims.productLine) return true;   // grand total or a dimension we do not scope
  return can(ctx.actor, "north:snapshots:read", {
    tenantId: ctx.tenantId, module: "north",
    ...(dims.team ? { teamId: dims.team } : {}),
    ...(dims.productLine ? { productLine: dims.productLine } : {})
  });
}
```

Zero new fields, zero new RBAC concepts. The **documented limitation**: a
grand-total row (`dimsHash: ""`) stays tenant-wide visible, so a team-scoped
regional head sees the company headline plus only their own team's split. That
is the intended behaviour for an executive module — hiding the headline from a
regional head makes the module useless to them — and it is stated here rather
than discovered later. If a tenant needs the headline hidden too, that is a
separate grant shape and needs an ADR, not a predicate.

### B.6 New approval policy — one

Added to `APPROVAL_POLICIES` in `packages/core/src/approvals.ts` (the object
literal beginning at `:41`):

```
policy({
  key: "north.decision_commit",
  module: "north",
  decide: "north:decisions:approve",
  dualControl: "above_threshold",
  defaultThresholdMinor: 100_000_00
})
```

Not `neverAutoApprove`. Reasoning, stated so it can be argued with: the
`neverAutoApprove` set at `approvals.ts:41-70` is client money, payouts,
settlements and manual journals — things that move money out of the business.
Committing a NORTH decision does not move money; it records that the company
has chosen an option. The money movement happens in AXIS or the ledger, behind
*their* gates, which are `neverAutoApprove`. Making `north.decision_commit`
never-auto-approvable would let a tenant believe it had a second control when
it has the same control twice. `dualControl: "above_threshold"` keyed on the
decision's declared `expectedImpactMinor` is the honest setting.

`singleUse` stays default (true): one approval commits exactly one decision.

---

## C. Data model

### C.1 Existing tables — what changes

#### `north_metrics` (`packages/db/src/schema/north.ts:7-26`)

Add four columns. Forward-only migration, all nullable or defaulted, so the
existing seeded rows keep working.

| Column | Drizzle | Why |
|--------|---------|-----|
| `source_kind` | `text("source_kind").notNull().default("operational")` | `ledger` \| `operational` \| `derived` \| `manual`. This is the F49 flag. |
| `ledger_tie_json` | `text("ledger_tie_json")` | `{"accounts":[{"code":"4000","sign":"credit"},{"code":"4010","sign":"credit"}],"report":"commissionByDimension","field":"netMinor"}` — null for non-ledger metrics. |
| `tie_tolerance_bp` | `integer("tie_tolerance_bp").notNull().default(0)` | 0 = must match to the minor unit. Anything above 0 is a deliberate, reviewable allowance. |
| `version` | `integer("version").notNull().default(1)` | Bumped by the version-append trigger in C.2. |
| `baseline_method` | `text("baseline_method").notNull().default("auto")` | `auto` \| `prior_period` \| `yoy` \| `seasonal_robust_z`. `auto` resolves per §F.4. |
| `driver_tree_key` | `text("driver_tree_key")` | Names an entry in the driver registry (§G). Null = leaf metric, no decomposition. |

#### `north_snapshots` (`schema/north.ts:28-45`)

Two columns. Both load-bearing for F48.

| Column | Drizzle | Why |
|--------|---------|-----|
| `period_state` | `text("period_state").notNull().default("closed")` | `open` \| `closed`. **This single column is the F48 fix.** An open month-to-date row is never a detection input and is never a baseline. |
| `source_kind` | `text("source_kind").notNull().default("operational")` | Denormalised from the metric at write time so a snapshot is self-describing three years later, after the definition changed. |
| `tie_out_id` | `text("tie_out_id")` | FK-by-convention to `north_tieouts.id`. Null for non-money metrics. |

The unique index `north_snapshots_uq` on
`(tenantId, metricKey, grain, period, dimsHash)` at `schema/north.ts:43` is
**unchanged**. An open MTD row is still upserted daily; it just stops being
mistaken for evidence.

#### `north_anomalies` (`schema/north.ts:68-85`)

The existing row records `magnitude`, `expected`, `actual`, `state` and
`driverAnalysisJson` — enough for a headline, not enough for a defensible one.
Add:

| Column | Drizzle | Why |
|--------|---------|-----|
| `grain` | `text("grain").notNull().default("day")` | Today `window` conflates the grain and the period. |
| `period` | `text("period")` | The explicit period; `window` is kept as-is so the existing dedupe key at `north-snapshotter.ts:321-331` and its test keep passing. |
| `dims_hash` | `text("dims_hash").notNull().default("")` | Anomalies on a channel split, not only on the headline. |
| `baseline_method` | `text("baseline_method").notNull().default("prior_period")` | Which of the three fired. |
| `baseline_value` | `integer("baseline_value")` | What the method expected, in the metric's own units. |
| `baseline_json` | `text("baseline_json")` | Every input: the periods read, their values, the seasonal index in bp, the median, the MAD, the observation count, the cold-start flag. This is the "why" the ambient-AI grammar (docs/15) requires to be inspectable. |
| `z_score_bp` | `integer("z_score_bp")` | Robust z × 10 000, so it stays an integer like everything else. |
| `severity` | `text("severity").notNull().default("warn")` | `info` \| `warn` \| `critical`. |
| `decision_id` | `text("decision_id")` | The P2 loop closure. |
| `dismissed_reason` | `text("dismissed_reason")` | A dismissal without a reason is not a decision, it is a shrug. |
| `resolved_at` | `integer("resolved_at")` | |
| `explanation_ai_audit_id` | `text("explanation_ai_audit_id")` | Points at the `ai_audit_log` row for the explainer call. |

Add index `north_anomalies_metric_idx` on
`(tenantId, metricKey, grain, period)` — the dedupe lookup and the anomaly
detail screen both need it.

#### `north_decisions` (`schema/north.ts:140-157`)

| Column | Drizzle | Why |
|--------|---------|-----|
| `anomaly_id` | `text("anomaly_id")` | The other half of the loop. |
| `expected_impact_minor` | `integer("expected_impact_minor")` | Signed. Feeds the approval threshold (§B.6) and the outcome comparison. |
| `expected_impact_metric_key` | `text("expected_impact_metric_key")` | Which metric this decision claims it will move. Without this, an outcome review is an opinion. |
| `expected_impact_by` | `integer("expected_impact_by")` | Epoch ms. By when. |
| `actual_impact_minor` | `integer("actual_impact_minor")` | Written once, at outcome review, from the metric — not typed by the owner. |
| `approval_id` | `text("approval_id")` | The `gate()` result. |
| `committed_at` | `integer("committed_at")` | |
| `reversed_reason` | `text("reversed_reason")` | `status` already allows `reversed` (`schema/north.ts:152`) with nowhere to say why. |

#### `north_scenarios` (`schema/north.ts:87-102`)

No new columns. The existing `question`, `assumptionsJson`, `resultJson`,
`author`, `sharedWithJson` describe a scenario's *identity*. Its *runs* move to
a new table (C.2) so that a re-run does not silently overwrite the numbers
somebody screenshotted into a board pack. `result_json` on the parent becomes a
denormalised pointer at the latest run and is documented as such.

Add one column: `latest_run_id` `text("latest_run_id")`.

#### `north_boardpacks`, `north_alert_rules`

Unchanged.

### C.2 New tables — six

All carry `tenant_id`. All go through `withTenant`. Money in minor units,
percent and ratio in basis points, matching the existing convention
(`schema/north.ts:38`, `narrator-verify.ts:32-42`).

#### 1. `north_metric_versions` — append-only

`docs/modules/north.md` §8 requires "a metric definition change shows as a
chart annotation". Today `resources.ts:520` registers metrics as `rw`, so a
definition edit is silent and unrecoverable.

```ts
export const metricVersions = sqliteTable(
  "north_metric_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    metricKey: text("metric_key").notNull(),
    version: integer("version").notNull(),
    nameJson: text("name_json").notNull(),
    definitionSqlRef: text("definition_sql_ref").notNull(),
    unit: text("unit").notNull(),
    currency: text("currency"),
    grain: text("grain").notNull(),
    sourceKind: text("source_kind").notNull(),
    ledgerTieJson: text("ledger_tie_json"),
    driverTreeKey: text("driver_tree_key"),
    baselineMethod: text("baseline_method").notNull(),
    changeNote: text("change_note"),
    changedBy: text("changed_by").notNull(),
    effectiveFrom: integer("effective_from").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("north_metric_versions_uq").on(t.tenantId, t.metricKey, t.version),
    index("north_metric_versions_eff_idx").on(t.tenantId, t.metricKey, t.effectiveFrom)
  ]
);
```

Written by an `afterWrite` hook on the `metrics` resource, never by a client.
`crud.ts:118` gives `beforeWrite` the `env`; `afterWrite` at `:124` does not —
this insert needs only `ctx.db`, so `afterWrite` is sufficient. Registered
read-only in the CRUD registry (`ro("north:metrics:read")`, `immutable: true`).

#### 2. `north_tieouts` — append-only. This is F49's audit trail.

```ts
export const tieouts = sqliteTable(
  "north_tieouts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    metricKey: text("metric_key").notNull(),
    grain: text("grain").notNull(),
    period: text("period").notNull(),
    metricValueMinor: integer("metric_value_minor").notNull(),
    ledgerValueMinor: integer("ledger_value_minor"),
    ledgerSourceRef: text("ledger_source_ref").notNull(), // "commissionByDimension:netMinor" | "trialBalance:4000+4010" | "none"
    diffMinor: integer("diff_minor"),
    diffBp: integer("diff_bp"),
    toleranceBp: integer("tolerance_bp").notNull(),
    status: text("status").notNull(), // ok|drift|missing|not_applicable
    detailJson: text("detail_json"),
    checkedAt: integer("checked_at").notNull()
  },
  (t) => [
    uniqueIndex("north_tieouts_uq").on(t.tenantId, t.metricKey, t.grain, t.period, t.checkedAt),
    index("north_tieouts_status_idx").on(t.tenantId, t.status, t.checkedAt)
  ]
);
```

`status: "not_applicable"` is written for operational metrics too. A money
metric with **no** tie-out row for a period is a failure state the data-health
screen shows in red — silence is not evidence.

#### 3. `north_forecast_runs` — immutable

```ts
export const forecastRuns = sqliteTable(
  "north_forecast_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    metricKey: text("metric_key").notNull(),
    grain: text("grain").notNull(),               // day|month
    method: text("method").notNull(),             // damped_holt_seasonal|seasonal_naive|driver_projection
    basePeriod: text("base_period").notNull(),    // last actual period included
    horizon: integer("horizon").notNull(),        // periods ahead
    paramsJson: text("params_json").notNull(),    // {alpha, beta, phi, level, trend, seasonalBp[], mase, holdout}
    driverTreeKey: text("driver_tree_key"),
    assumptionsJson: text("assumptions_json"),    // primitives used, with their fittedAt and CI
    fitQualityJson: text("fit_quality_json").notNull(), // {maseHoldout, mapeBp, residualQuantilesBp}
    status: text("status").notNull().default("active"), // active|superseded|failed
    supersededBy: text("superseded_by"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    index("north_forecast_runs_idx").on(t.tenantId, t.metricKey, t.grain, t.createdAt),
    index("north_forecast_runs_status_idx").on(t.tenantId, t.status)
  ]
);
```

`status` and `supersededBy` are the only mutable fields, and only the forecast
engine writes them, inside the same statement batch that inserts the new run.
Everything else is write-once. Registered `ro("north:forecasts:read")` +
`immutable: true` in the CRUD registry; creation is the bespoke route only.

#### 4. `north_forecast_points` — immutable

```ts
export const forecastPoints = sqliteTable(
  "north_forecast_points",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    metricKey: text("metric_key").notNull(),
    grain: text("grain").notNull(),
    period: text("period").notNull(),
    dimsHash: text("dims_hash").notNull().default(""),
    p10: integer("p10").notNull(),
    p50: integer("p50").notNull(),
    p90: integer("p90").notNull(),
    driverContribJson: text("driver_contrib_json"), // {policies_issued: n, avg_premium: n, commission_rate: n}
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("north_forecast_points_uq").on(t.tenantId, t.runId, t.period, t.dimsHash),
    index("north_forecast_points_metric_idx").on(t.tenantId, t.metricKey, t.grain, t.period)
  ]
);
```

Three integers per point, never one. `docs/modules/north.md` §2.4: "no point
estimates without ranges." A `p50` with no `p10`/`p90` is a schema violation,
not a style preference — all three are `notNull`.

#### 5. `north_scenario_runs` — immutable

```ts
export const scenarioRuns = sqliteTable(
  "north_scenario_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    scenarioId: text("scenario_id").notNull(),
    baseForecastRunId: text("base_forecast_run_id").notNull(),
    assumptionsJson: text("assumptions_json").notNull(), // the deltas applied, ordered
    resultJson: text("result_json").notNull(),           // per period: {p10,p50,p90, byDriver}
    primitivesJson: text("primitives_json").notNull(),   // every elasticity/funnel rate used, with CI + fittedAt
    narrativeText: text("narrative_text"),
    modelRunRef: text("model_run_ref"),
    aiAuditId: text("ai_audit_id"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [index("north_scenario_runs_idx").on(t.tenantId, t.scenarioId, t.createdAt)]
);
```

`baseForecastRunId` is `notNull` on purpose: a scenario with no named base is
a number with no provenance. It also pins the comparison — two scenarios are
only comparable if they fork the same base, which §I.4 enforces.

#### 6. `north_decision_events` — append-only. This is the audit trail §J.5 needs.

```ts
export const decisionEvents = sqliteTable(
  "north_decision_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    decisionId: text("decision_id").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    // created|option_added|option_chosen|approval_requested|approved|rejected
    // |committed|review_due|outcome_recorded|reversed
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorRef: text("actor_ref").notNull(),
    approvalId: text("approval_id"),
    payloadJson: text("payload_json"),
    at: integer("at").notNull()
  },
  (t) => [
    uniqueIndex("north_decision_events_seq_uq").on(t.tenantId, t.decisionId, t.seq),
    index("north_decision_events_idx").on(t.tenantId, t.decisionId, t.at)
  ]
);
```

`seq` with a unique index is how append-only is *enforced* rather than
promised: two concurrent transitions cannot both claim `seq = n`, so one loses
on the index and retries against the new head. Same idiom as
`ledger_lines_seq_uq` (`packages/db/src/schema/ledger.ts:160`) and
`ledger_txn_transitions`.

### C.3 What goes through generic CRUD and what is bespoke

`apps/api/src/crud.ts:53-129` is the registry. The rule this design applies:
**generic CRUD for anything a human authors; bespoke route for anything an
engine derives.**

| Resource | Registration | Rationale |
|----------|--------------|-----------|
| `metrics` | `rw("north:metrics")` + `afterWrite` version-append | Human-authored definition. Keep `rw`. |
| `metric_versions` | `ro("north:metrics:read")`, `immutable: true` | Derived. |
| `snapshots` | `ro("north:snapshots:read")`, `immutable: true` (unchanged, `resources.ts:522`) + new `rowVisible` | Derived. **Immutable stays.** |
| `tieouts` | `ro("north:metrics:read")`, `immutable: true` | Derived. |
| `briefings` | unchanged: read + `north:briefings:approve` update, **no create** (`resources.ts:523-533`) | The comment there is right and stays right. |
| `anomalies` | unchanged: read + `north:anomalies:assign` update | Human triage of a derived row. |
| `scenarios` | unchanged `read/create/update` on `north:scenarios:*` | Human-authored identity. |
| `scenario_runs` | `ro("north:scenarios:read")`, `immutable: true` | Derived. Created by `POST /scenarios/:id/run` only. |
| `forecast_runs` | `ro("north:forecasts:read")`, `immutable: true` | Derived. |
| `forecast_points` | `ro("north:forecasts:read")`, `immutable: true` | Derived. |
| `boardpacks` | unchanged (`resources.ts:544-547`) | |
| `alert_rules` | unchanged `rw("north:alerts")` | Human-authored. |
| `decisions` | **narrowed** from `rw("north:decisions")` (`resources.ts:545`) to `{ read: "north:decisions:read", create: "north:decisions:write" }` — **no `update`** | See C.4. |
| `decision_events` | `ro("north:decisions:read")`, `immutable: true` | Derived. |

Bespoke routes (§L) for: snapshotter run + backfill, briefing generate,
anomaly explain, anomaly → decision, decision transition, driver decompose,
forecast run + variance, scenario run + compare, board pack, explore, data
health.

### C.4 Immutability and append-only — stated and enforced

**Snapshots are immutable.** Already `immutable: true` at `resources.ts:522`,
which makes `crud.ts` refuse `PATCH` and `DELETE`. Nothing here relaxes it. The
nightly upsert is not a mutation of a *closed* row — a closed period is written
exactly once (§F.2 makes that true rather than hoped for) and task T4 asserts
it with a test that runs the snapshotter twice over the same closed day and
compares the row's `id` and `ts`.

**Decisions are append-only.** Today they are not: `resources.ts:545` registers
`rw("north:decisions")`, so any holder of `north:decisions:write` can `PATCH`
`chosen`, `status`, `owner` and `outcomeReviewJson` directly, with no history
and no approval. The design:

1. Remove `update` from the resource. The generic `PATCH /v1/north/decisions/:id`
   stops existing and returns 405.
2. Every change goes through `POST /v1/north/decisions/:id/transitions`, which
   (a) validates the transition against a state machine, (b) calls `gate()` when
   the transition is `commit`, (c) inserts a `north_decision_events` row with
   the next `seq`, (d) updates the projection columns on `north_decisions` in
   the same statement batch, (e) calls `audit()`.
3. The projection row is explicitly documented as a projection. If it ever
   disagrees with the event log, the event log wins, and a rebuild function
   `rebuildDecision(ctx, decisionId)` exists for exactly that — the same
   relationship `ledger_account_balances` has to `ledger_journal_lines`
   (`packages/db/src/schema/ledger.ts:164`, "Rebuildable from lines").

The state machine, which is the whole of the P2 loop:

```
                 ┌────────── reject ──────────┐
                 v                            │
draft ──choose──> proposed ──request──> pending_approval ──approve──> approved
                                                                        │
                                                                     commit
                                                                        v
                                                                    committed
                                                                    │      │
                                                       review_recorded    reverse
                                                                    v      v
                                                                reviewed  reversed
```

Legal transitions live in one const in `packages/core/src/north-decisions.ts`,
the same shape as `INVOICE_TRANSITIONS` at `apps/api/src/resources.ts:553-560`.
Anything else is a 400, not a shortcut.

**Forecast runs, forecast points, scenario runs, tie-outs, metric versions and
decision events are all `immutable: true` in the registry.** The only mutable
field anywhere in the new tables is `north_forecast_runs.status` /
`supersededBy`, written only by the forecast engine, and task T13 asserts a
`PATCH` from a client is refused.

**Soft delete.** None of the six new tables has a `deleted_at`. Deriving a
number and then hiding it is how a board pack stops reconciling. The one place
a delete is meaningful is a scenario a person abandoned; scenarios keep the
generic delete on `north:scenarios:run`, and deleting a scenario leaves its
runs — a scenario is a folder, its runs are the record.

---

## D. Metric catalogue

### D.1 Conventions

- Money: minor units, integer. Percent and ratio: basis points (× 10 000),
  integer. Duration: milliseconds, integer. This matches
  `schema/north.ts:38`, `narrator-verify.ts:32-42` and
  `apps/web/app/routes/north-shared.tsx:120-157`.
- `dimsHash: ""` is the grand total (`schema/north.ts:37`).
- `source_kind`:
  - **`ledger`** — the value is produced by calling a function in
    `packages/ledger/src/reports.ts`. Tie-out tolerance 0 bp by definition:
    the metric *is* the ledger figure.
  - **`operational`** — the value comes from a module's own tables. It may be
    reconciled against the ledger but is not derived from it.
  - **`derived`** — a ratio of two other metrics.
  - **`manual`** — entered by a human (targets, budgets). Not currently used.

### D.2 The catalogue

Ten metrics exist in `north-snapshotter.ts:196-207`. This design keeps all ten
(changing two), and adds seven. `loss_ratio` and `renewal_retention_rate` stay
seeded-but-uncomputed per ADR-0024.

| Metric key | Grain | Unit | `source_kind` | Definition | Source | Board-safe |
|-----------|-------|------|---------------|------------|--------|-----------|
| `policies_issued` | day | count | operational | `count(axis_policies where created_at in [d, d+1))` | `axis_policies` | yes |
| `quote_to_bind_rate` | day | ratio (bp) | derived | `10000 × binds / quotes` over the day | `axis_quotes`, `axis_policies` | yes |
| `panel_response_rate` | day | ratio (bp) | operational | `10000 × responded / requested` | `axis_panel_requests` | yes |
| `quote_latency_p95` | day | duration_ms | operational | p95 of `responded_at − requested_at` | `axis_panel_requests` | yes |
| `active_policies` | month | count | operational | `count(axis_policies where status='active' as of month end)` | `axis_policies` | yes |
| `broker_channel_share` | month | ratio (bp) | operational | `10000 × broker-sourced policies / all policies` | `axis_policies` | yes |
| `cac_per_policy` | month | money | derived | `signal spend in month / policies_issued in month` | `signal_*`, `axis_policies` | yes |
| `ai_cost_per_case` | month | money | derived | `sum(ai_audit_log.cost_minor) / count(axis_cases)` | `ai_audit_log` | yes |
| **`gwp`** | month | money | **operational** | `sum(axis_policies.premium_minor where created_at in month)` — **written premium, not a ledger figure** | `axis_policies` | **no** (§E.3) |
| **`net_commission`** | month | money | **ledger** ← *changed from operational* | `Σ commissionByDimension(ctx, "channel", {periodCode}).rows[].netMinor` | `ledger_journal_lines` 4000/4010 net of 2100 | yes |
| **`premium_collected`** *(new)* | month | money | ledger | net credits to account `2010` (client money held) in the period | `ledger_journal_lines` | yes |
| **`commission_receivable`** *(new)* | month | money | ledger | closing balance of account `1100` at period end | `trialBalance` | yes |
| **`client_money_balance`** *(new)* | month | money | ledger | `clientMoneyPosition(ctx)` at period end | `reports.ts:188` | yes |
| **`revenue_recognised`** *(new)* | month | money | ledger | `profitAndLoss(ctx, periodCode).income` total | `reports.ts:339` | yes |
| **`gross_margin_bp`** *(new)* | month | ratio (bp) | ledger | `profitAndLoss(ctx, periodCode).marginPpm / 100` | `reports.ts:339` | yes |
| **`cash_collected`** *(new)* | month | money | ledger | net debits to `1000` (own bank) in the period | `ledger_journal_lines` | yes |
| **`channel_share_payable`** *(new)* | month | money | ledger | closing balance of account `2100` | `trialBalance` | yes |
| `loss_ratio` | month | ratio | — | **not computed** (ADR-0024) | — | restricted |
| `renewal_retention_rate` | month | ratio | — | **not computed** (ADR-0024) | — | yes |

Account codes above are the ones the seed actually posts to:
`1000` own bank, `1010` client bank, `1100` commission receivable, `1160` trade
receivable, `2010` client money held, `2100` channel share payable, `2200` VAT,
`2300` deferred revenue, `4000` new-business commission, `4010` renewal
commission, `4040` subscription revenue, `4050` usage revenue,
`5300` bank charges (`packages/core/src/seed/ledger.ts:627-768`).

### D.3 Metric name and definition are versioned, not edited

Every write to `north_metrics` appends a `north_metric_versions` row and bumps
`north_metrics.version`. The Metric Explorer (§K.2) draws a vertical annotation
on the chart at each `effective_from`, which is
`docs/modules/north.md` §8's fourth acceptance criterion, currently
unsatisfiable because nothing records the change.

A definition change **does not** rewrite history. Snapshots before
`effective_from` keep their old-definition values and the chart annotates the
discontinuity rather than smoothing it. Backfilling under a new definition is a
separate, explicit operation (`POST /snapshotter/backfill` with
`recomputeUnderVersion`), and it writes new tie-out rows so the change is
auditable.

---

## E. The ledger tie-out (F49)

### E.1 The bug, precisely

`apps/api/src/engines/north-snapshotter.ts:105-113`:

```ts
const gwp: Compute = async (ctx, p) => { ... sum(schema.axisPolicies.premiumMinor) ... }
```

and `:115-123` does the same for `commissionMinor`, both windowed on
`axisPolicies.createdAt`. So:

- A policy cancelled inside the same month still counts, because
  `axis_policies` rows are not deleted and the window is on creation.
- A commission clawback posts a reversal to the ledger
  (`packages/core/src/seed/ledger.ts:672-674`) and changes nothing in
  `axis_policies.commission_minor`.
- A channel's 30% share is a credit to `2100`
  (`seed/ledger.ts:657`) and is invisible to a `sum(commission_minor)` — so
  `net_commission` is not net of anything.
- The board pack (`apps/api/src/routes/north.ts:52-104`) renders these numbers
  into a PDF beside the decision log, and nothing in the pipeline ever compares
  them to the general ledger.

The briefing then quotes them, and `verifyNumericClaims`
(`packages/core/src/narrator-verify.ts:91`) confirms the prose matches the
snapshot. **It does. That is the problem.** The verifier proves the narrative
is faithful to the number; F49 is a bug in the number. This is why the existing
`evals/north` suite is at recall 1.0 and still would not catch it, and it is
why §M.3 adds a different eval.

### E.2 The fix — two rules, one mechanism

**Rule 1: a metric whose `source_kind` is `ledger` is computed by calling
`packages/ledger/src/reports.ts`, never by summing a module table.**

`net_commission` becomes:

```
netCommission(ctx, periodCode) =
  Σ over rows of commissionByDimension(ctx, "channel", { periodCode }) of row.netMinor
```

`commissionByDimension` at `reports.ts:475-507` already filters
`accountCode like '40%' or accountCode = '2100'` and splits `channelShareMinor`
(the 2100 credits) from `netMinor`. Reversals are debits to the same accounts
and net out automatically, which is the entire reason to read the ledger. The
seeded clawback at `seed/ledger.ts:672-674` becomes the regression fixture: the
old compute returns the pre-clawback figure, the new one does not.

`premium_collected`, `commission_receivable`, `client_money_balance`,
`revenue_recognised`, `gross_margin_bp`, `cash_collected` and
`channel_share_payable` are all defined the same way — as thin adapters over
existing report functions. **No new SQL against `ledger_journal_lines` is
written in NORTH.** NORTH does not get its own opinion about the ledger; the
ledger package is the only place that reads journal lines. That also keeps
CLAUDE.md §6 intact (`packages/ledger` is reached through `packages/core`'s
allowance for shared packages, not through a cross-module import).

**Rule 2: a money metric whose `source_kind` is `operational` gets a recorded
reconciliation every period, and is barred from board and investor surfaces.**

`gwp` stays operational, and this is a deliberate accounting position rather
than laziness: for a broker, gross written premium is **not** the tenant's
revenue. Premium moves through client money (`1010` debit / `2010` credit,
`seed/ledger.ts:687-688`) and out again (`seed/ledger.ts:713-714`). There is no
general-ledger account whose balance *is* GWP, and inventing one to satisfy a
tie-out would be worse than the bug. So:

- `gwp.source_kind = "operational"`, `ledger_tie_json` names its
  **reconciliation counterpart** (`premium_collected`) rather than a derivation.
- Every month the tie-out engine writes a `north_tieouts` row for `gwp` with
  `ledger_source_ref: "reconcile:premium_collected"`, `diffMinor` =
  `gwp − premium_collected`, and `status`:
  - `ok` if `0 ≤ diff` and `diffBp ≤ tie_tolerance_bp` (default 4 000 bp = 40%,
    the collection lag),
  - `drift` if `diff < 0` (more collected than written — impossible without a
    data error) or `diffBp` above tolerance.
- `board_safe` is computed, not stored: a metric is board-safe iff
  `source_kind = "ledger"` **or** its latest tie-out `status = "ok"`. `gwp` is
  listed as not board-safe in D.2 because its tolerance is wide enough that a
  board number derived from it would be misleading.

**The enforcement point**, which is what makes this a design rather than a
wish: `assembleBoardpackSections` (`apps/api/src/engines/north-boardpack.ts`)
and `generateBriefing` for `audience` in `{board, investor}`
(`apps/api/src/engines/narrator.ts:167`) both filter their metric input through
`boardSafe(ctx, metricKeys)`. A metric that is not board-safe is **excluded**
from the pack and from the snapshot handed to the model, and its exclusion is
printed as a footnote row so the omission is visible. A model cannot cite a
number it was never given.

### E.3 The tie-out engine

New: `packages/core/src/north-tieout.ts`, called from the snapshotter after
each period's metrics are written and before anomaly detection runs.

```
for each money metric m with a closed period p just written:
  if m.source_kind == "ledger":
     ledgerValue = the same report call that produced it, re-executed
     status = ledgerValue === metricValue ? "ok" : "drift"      // tolerance 0
  else if m.ledger_tie_json names a reconciliation counterpart:
     ledgerValue = snapshot(counterpart, p)
     diffBp = round(10000 * (metricValue - ledgerValue) / max(1, |ledgerValue|))
     status = (diff >= 0 && diffBp <= m.tie_tolerance_bp) ? "ok" : "drift"
  else:
     status = "not_applicable"
  insert north_tieouts row; set north_snapshots.tie_out_id
  if status == "drift": emit north.metric.tie_broken and raise a critical anomaly
```

Re-executing the report call for a ledger metric looks redundant and is not: it
catches the case where the snapshot was written under metric version *n* and
the definition has since moved to *n+1*, and the case where a late journal was
back-posted into a closed period. A ledger metric that drifts is `critical`
severity by definition (§F.5) — a number in the board pack no longer agrees
with the general ledger, and that is the single loudest thing NORTH can say.

### E.4 What the CFO sees

The NORTH Admin screen (§K.7) has a **Tie-out** tab: one row per money metric
per period, with `metricValue`, `ledgerValue`, `diff`, `tolerance`, `status`,
`checkedAt`, and a link through to the ledger report that produced the ledger
figure. A number in a board pack is three clicks from a trial balance. That is
the acceptance test for F49, not the absence of the bug.

---

## F. Anomaly detection redesign (F48)

### F.1 The bug, precisely

`north-snapshotter.ts:261-272` selects the existing row for
`(tenant, metricKey, grain, period, dimsHash "")` in order to decide between
insert and update. `:305` then reuses that same row as the baseline:

```ts
const prevValue = existing?.value;
```

"Previous" therefore means *the previous write of this very period*. Two
distinct failures:

- **Day grain.** `periodsFor` (`:30-37`) returns yesterday, which is written
  once per nightly run. `existing` is `undefined`, `prevValue` is `undefined`,
  and the anomaly branch never fires. **Day-grain anomaly detection does not
  exist.**
- **Month grain.** The month-to-date row is rewritten every night, so
  `prevValue` is yesterday's cumulative MTD. On the 1st of a month the fresh
  MTD collapses to near zero against a full prior month, `magnitude` is roughly
  −10 000 bp, and every money metric fires a false critical **on the first
  night of every month, forever.**

And `narrator.ts:83-88`, thirty metres away in the same repo, does the
comparison correctly against `previousDay` / `previousMonth`. The two engines
disagree today; a briefing can say a metric is flat while an anomaly row says
it collapsed.

### F.2 Fix part one — the closed-period rule

The root cause is not the baseline lookup. It is that an **open** period is
being treated as an observation. So:

- `north_snapshots.period_state` is `open` for the current MTD row and
  `closed` for any period whose window has fully elapsed at write time
  (`north-baseline.ts#isClosed(grain, period, now)`).
- **Anomaly detection only ever runs on `closed` periods.** The open MTD row
  is still written every night — the Today screen needs it — and is never a
  detection subject and never a baseline.
- A month is therefore detected exactly once, on the first snapshotter run
  after the month ends, and the false-alarm-every-month behaviour is gone by
  construction rather than by threshold tuning.
- Intra-month monitoring is not lost: it is served by the **day**-grain metrics,
  which now actually detect (see F.3), and by the alert rules at
  `north-snapshotter.ts:293-303`, which are threshold rules on the current
  value and are legitimately allowed to read the open row.

`period_state` also gives the UI something honest to render: the Today screen
labels the MTD figure "month to date, 12 of 31 days" instead of implying a
month.

### F.3 Fix part two — three named baselines

New pure module `packages/core/src/north-baseline.ts`. Pure so it is
unit-testable and lands inside the Stryker ≥70% ratchet that already covers
`packages/core`.

```ts
export type BaselineMethod = "prior_period" | "yoy" | "seasonal_robust_z";

export interface Observation { period: string; value: number; }

export interface Baseline {
  method: BaselineMethod;
  value: number;             // expected, in the metric's own units
  deltaBp: number;           // signed, (actual - value) / |value|
  zScoreBp: number | null;   // robust z x 10000, null when the method has no variance model
  seasonalIndexBp: number | null;
  observations: number;      // how many same-phase periods were available
  coldStart: boolean;
  inputs: Observation[];     // every period actually read — this is the "why"
}

export function baselineFor(
  method: BaselineMethod,
  grain: "day" | "month",
  period: string,
  actual: number,
  history: readonly Observation[]   // closed periods only, ascending
): Baseline;
```

**B1 `prior_period`.** The immediately preceding closed period of the same
grain and the same `dimsHash`. Day: `period − 1 day`. Month: the previous
calendar month. `zScoreBp: null`. This is what `narrator.ts:83-88` already
does, and B1 is the *floor* — every metric gets at least this.

**B2 `yoy`** — same period last year. Day: **`period − 364 days`**, not
`−365`. 364 is 52 weeks exactly, so a Tuesday compares to a Tuesday. For a
business whose quote volume has a weekday shape — every broker — comparing a
Monday to a Sunday is worse than not comparing. Month: the same month index in
the prior year (`2025-03` for `2026-03`). Applies to metrics whose movement is
dominated by an annual cycle: renewals, seasonal product lines.

**B3 `seasonal_robust_z`** — the default for day grain and the method
`docs/modules/north.md` §2.3 means by "seasonal-aware per-metric baselines".

```
phase(d)      = weekday(d)                       for grain = day
phase(m)      = month index 1..12                for grain = month

samePhase     = last N closed observations with the same phase
                N = 8  (day: 8 weeks)   N = 3  (month: 3 years)
allRecent     = last 56 closed day observations   /  last 24 closed months

seasonalIndexBp = round(10000 * median(samePhase) / max(1, median(allRecent)))
deseasonalised  = value * 10000 / seasonalIndexBp          for each obs in allRecent
median          = median(deseasonalised)
MAD             = median(|x - median|)  over deseasonalised
robustZ         = 0.6745 * (deseasonalised(actual) - median) / max(1, MAD)
baselineValue   = round(median * seasonalIndexBp / 10000)
```

`0.6745` is the constant that makes MAD a consistent estimator of σ for a
normal distribution; the median-and-MAD pair is used instead of mean-and-σ
because one genuinely anomalous day would otherwise inflate σ and hide the
next one. All arithmetic is integer with explicit rounding at the named points,
so D1 and libSQL agree to the unit (CLAUDE.md §2).

**Cold start.** Fewer than 6 same-phase observations, or `MAD = 0`: the method
degrades to `prior_period`, `coldStart: true`, and severity is capped at `info`
(§F.5). A three-week-old tenant does not get paged about its seasonality.

### F.4 Which method a metric uses

`north_metrics.baseline_method` defaults to `"auto"`, resolved as:

| Grain | Unit | Resolved method |
|-------|------|-----------------|
| day | any | `seasonal_robust_z` |
| month | money or count | `seasonal_robust_z` if ≥ 24 closed months, else `yoy` if ≥ 12, else `prior_period` |
| month | ratio / percent | `prior_period` — a ratio is already normalised, and 24 months of a ratio's MAD on a young tenant is noise |

A tenant can override per metric from NORTH Admin (`north:metrics:write`),
which appends a metric version and therefore shows as a chart annotation.

### F.5 Firing rule and severity

Both conditions must hold. Either alone is a pager nobody trusts:

```
fires  =  |deltaBp vs baseline.value| >= anomalyThresholdBp(unit)     // magnitude
      AND (baseline.zScoreBp === null || |zScoreBp| >= 35_000)        // 3.5 sigma
```

`anomalyThresholdBp` is kept exactly as it is at
`north-snapshotter.ts:210-212` (500 bp for percent/ratio, 1 500 bp otherwise).
It is not the problem and changing it here would muddy the F48 regression test.

Severity:

| Severity | Condition |
|----------|-----------|
| `critical` | the metric is `source_kind: "ledger"` and its tie-out for this period is `drift`; **or** `|zScoreBp| ≥ 50_000` (5σ) |
| `warn` | fires, not cold start |
| `info` | fires under cold start, or a `prior_period` fallback with no variance model |

### F.6 What is stored, and dedupe

Every fired anomaly stores `baseline_method`, `baseline_value`, `z_score_bp`,
`severity`, `dims_hash`, `grain`, `period` and a `baseline_json` containing the
full `Baseline.inputs` array. An exec clicking "why" on the Anomalies screen
sees the eight Tuesdays the baseline was built from, with their dates and
values. That is docs/15's inspectability requirement discharged with data, not
with prose.

Dedupe keeps the existing shape (`north-snapshotter.ts:321-331`: skip if a
`state = "new"` row already exists for the same metric and window) and extends
the key with `dims_hash`, so a channel-level anomaly and a headline anomaly on
the same metric are two rows.

Emission: `north.anomaly.detected` via `emit(ctx, { module: "north", type:
"north.anomaly.detected", subject: anomalyId, data: {...} })`. `docs/04-api.md:80`
has been advertising this event to webhook subscribers and it has never fired.

### F.7 Backfill — the baselines need history

`periodsFor` at `north-snapshotter.ts:30-37` returns two periods, so a fresh
tenant has no history and `seasonal_robust_z` never leaves cold start. Add
`POST /v1/north/snapshotter/backfill { from, to, metricKeys? }`
(`north:snapshots:run`), which iterates closed periods in the window, computes
each metric, writes snapshots with `period_state: "closed"`, writes tie-outs,
and **does not run anomaly detection** — backfilling 24 months would otherwise
generate a wall of historical anomalies nobody will read.

Backfill is chunked (one period per queue message) so a two-year backfill of
seventeen metrics does not exceed a Worker's CPU budget.

---

## G. Driver decomposition

### G.1 The tree is declarative

New registry `packages/core/src/north-drivers.ts`. A tree is a metric expressed
as an exact function of other metrics. Nothing is fitted; these are identities.

```ts
export type DriverNode =
  | { kind: "metric"; metricKey: string }
  | { kind: "product"; factors: DriverNode[] }        // a = b * c * d
  | { kind: "sum"; over: "dims"; dim: string; of: DriverNode }
  | { kind: "ratio"; numerator: DriverNode; denominator: DriverNode }
  | { kind: "mix"; dim: string; weight: DriverNode; rate: DriverNode };

export const DRIVER_TREES: Record<string, DriverNode> = { ... };
```

The four trees this design ships:

**`net_commission`**

```
net_commission
  = Σ over channel of  commission(channel)
  commission(channel) = policies_issued(channel)
                      × avg_premium(channel)
                      × commission_rate(channel)
```

`avg_premium` and `commission_rate` are derived at decomposition time from
snapshot dimensions (`gwp(channel) / policies_issued(channel)` and
`net_commission(channel) / gwp(channel)`), so no new snapshot rows are needed —
the seeded `DECEMBER_SPLITS` at `packages/core/src/seed.ts:1263+` already
provide the channel-dimensioned inputs, and they already sum to the December
headline, which is exactly the invariant this depends on.

**`gwp`**

```
gwp = policies_issued × avg_premium
```

**`cac_per_policy`**

```
cac_per_policy = marketing_spend / policies_issued
```

A ratio, so the decomposition is the ratio rule (G.3).

**`quote_to_bind_rate`**

```
quote_to_bind_rate = Σ over segment of  weight(segment) × bind_rate(segment)
  weight(segment)    = quotes(segment) / quotes(total)
  bind_rate(segment) = binds(segment)  / quotes(segment)
```

A mix node, so the decomposition splits rate effect from mix effect (G.4).

### G.2 Products — exact Shapley, not sequential substitution

For `y = x₁ · x₂ · … · x_k`, the change `Δy = y₁ − y₀` is attributed by the
Shapley value over the k! orderings of substituting each factor from its
baseline value to its actual value:

```
φ_i = (1/k!) Σ over orderings π of [ f(S_π^i ∪ {i}) − f(S_π^i) ]
```

For k = 2 this collapses to the familiar symmetric split with the interaction
term halved. For k = 3 it is 6 orderings, 12 evaluations of a product — free.
This design **caps k at 4** (24 orderings) and refuses to register a tree with
more factors; a five-factor identity is a modelling smell, not a compute
problem.

Why Shapley and not the cheaper sequential substitution: sequential
substitution gives a different answer depending on the order you substitute in,
so two people looking at the same board pack get two different attributions
for the same movement. Shapley is order-independent and the residual is exactly
zero.

**The property test** (`packages/core/src/north-drivers.test.ts`, and the
reason this belongs in `core` under the mutation ratchet):

```
for any tree, any baseline vector, any actual vector:
   Σ contributions == Δy    exactly, in integer minor units
```

Integer rounding is handled explicitly: contributions are computed in a wider
intermediate, rounded half-to-even, and the residual (never more than k−1 minor
units) is assigned to the factor with the largest `|φ_i|` and **reported** as
`roundingMinor` in the output rather than silently absorbed. A CFO who adds up
the column gets the total.

### G.3 Ratios

For `y = n / d`:

```
Δy = Δn / d₁              (numerator effect, evaluated at the new denominator)
   + n₀ · (1/d₁ − 1/d₀)   (denominator effect, evaluated at the old numerator)
```

The two terms sum exactly to `Δy`. The asymmetry (new denominator, old
numerator) is the standard convention and is documented in the output so the
same convention is used everywhere; the alternative ordering appears as
`alternateSplit` in the detail JSON for anyone who wants it.

### G.4 Mix nodes — rate effect, mix effect, and the interaction named out loud

For `y = Σ wᵢ rᵢ` with `Σ wᵢ = 1`:

```
rate effect        = Σ wᵢ⁰ · Δrᵢ
mix effect         = Σ Δwᵢ · rᵢ⁰
interaction        = Σ Δwᵢ · Δrᵢ
```

Three named rows, summing exactly to `Δy`. The interaction term gets its own
row instead of being folded into one of the other two — folding it is the
single most common way a "the mix moved" narrative turns out to be false.

### G.5 Where it runs and what it produces

- Route `POST /v1/north/drivers/decompose { metricKey, grain, period, comparePeriod?, dim? }`,
  permission `north:snapshots:read`.
- Called automatically by the anomaly detector for any metric with a
  `driver_tree_key`, result written to the existing
  `north_anomalies.driver_analysis_json` column (`schema/north.ts:78`). No new
  table.
- Called by the forecast variance report (§H.5) with the actual and the p50 as
  the two vectors, which is how "why did the number miss" is answered.
- Output shape:

```json
{
  "metricKey": "net_commission",
  "from": { "period": "2025-12", "value": 4310000 },
  "to":   { "period": "2026-01", "value": 3980000 },
  "deltaMinor": -330000,
  "contributions": [
    { "path": "channel=broker.policies_issued", "minor": -180000, "shareBp": 5454 },
    { "path": "channel=broker.avg_premium",     "minor":  -40000, "shareBp": 1212 },
    { "path": "channel=direct.commission_rate", "minor": -110000, "shareBp": 3333 }
  ],
  "roundingMinor": 0,
  "residualMinor": 0
}
```

`residualMinor` is in the payload and is asserted to be zero. A non-zero
residual is a bug that ships visibly rather than quietly.

---

## H. Forecast

### H.1 Requirements this satisfies

- A named algorithm a CFO can reproduce.
- Stored parameters — no re-fit needed to explain an old number.
- Ranges, never point estimates (`docs/modules/north.md` §2.4).
- Immutable, versioned runs.
- Actuals-vs-forecast variance, attributed down the driver tree.

### H.2 The algorithm — damped Holt on the deseasonalised series

Method key `damped_holt_seasonal`. Engine
`packages/core/src/north-forecast.ts`, pure, integer-safe, no I/O.

```
INPUT   closed observations y[1..n] for (metricKey, grain, dimsHash)
        minimum n: 12 for month grain, 56 for day grain

1  SEASONAL INDICES
   phase(t) = weekday for day grain, month-of-year for month grain
   sᵢ = median{ y[t] : phase(t) = i } / median{ y }        (stored as bp)
   normalise so mean(sᵢ) = 1 exactly (residual to the largest index)

2  DESEASONALISE
   d[t] = y[t] * 10000 / s_{phase(t)}

3  DAMPED HOLT on d[·]
   level[t] = α·d[t]        + (1−α)(level[t−1] + φ·trend[t−1])
   trend[t] = β(level[t] − level[t−1]) + (1−β)·φ·trend[t−1]
   forecast h steps ahead:
     d̂[n+h] = level[n] + trend[n]·Σ_{i=1..h} φ^i

4  RESEASONALISE
   ŷ[n+h] = d̂[n+h] * s_{phase(n+h)} / 10000

5  FIT
   α, β ∈ {0.1,0.2,…,0.9}, φ ∈ {0.80,0.85,0.90,0.95,1.00}
   chosen by grid search minimising MASE on a rolling holdout of the last
   H periods (H = 3 for month, 14 for day).
   405 combinations x n steps — microseconds, deterministic, no optimiser.

6  INTERVALS — empirical, not Gaussian
   r[h] = the holdout residuals at horizon h, as a fraction of the actual (bp)
   p10[n+h] = ŷ[n+h] * (10000 + q10(r[h]) * sqrt(h)) / 10000
   p50[n+h] = ŷ[n+h]
   p90[n+h] = ŷ[n+h] * (10000 + q90(r[h]) * sqrt(h)) / 10000
   With fewer than 8 holdout residuals, fall back to a fixed ±2500 bp band at
   h=1 widening by sqrt(h), and set fitQualityJson.intervalSource = "default".
```

φ (damping) exists because an undamped linear trend extrapolated twelve months
out produces the kind of number that gets a forecast deleted. `φ = 0.9` on a
monthly series flattens the trend to about 65% of its naive extrapolation by
month 12, which is the conservative default; the grid can choose `φ = 1.0` if
the data genuinely warrants it, and the chosen value is on the screen.

**Why not ARIMA, Prophet, or a gradient booster.** A board number has to be
defensible in a room. Every intermediate here — the seasonal index per weekday,
the level, the trend, the damping, the residual quantile — is a number on the
Forecast tab that a person can point at. CLAUDE.md's "prefer boring
technology" applies with unusual force to numbers a regulator may ask about.

### H.3 Driver-based projection — the second method

Method key `driver_projection`. For a metric with a `driver_tree_key`, forecast
each **leaf** with `damped_holt_seasonal`, then recompose up the tree. This is
what makes a forecast explainable and what makes a scenario possible: a
scenario perturbs a leaf, not the headline.

`driverContribJson` on each forecast point carries the leaf values that
produced the p50, so a scenario's delta is applied to a named leaf and the
recomposition is the same code path as the actuals decomposition (§G).

If a leaf has too little history, the whole tree falls back to
`damped_holt_seasonal` on the headline and `fitQualityJson.fallbackReason`
records which leaf caused it. A silent fallback is a lie.

### H.4 Storage and versioning

- `POST /v1/north/forecasts/run { metricKey, grain, horizon, method? }`,
  permission `north:forecasts:run`.
- Writes one `north_forecast_runs` row and `horizon` × (1 + dimension count)
  `north_forecast_points` rows, in one statement batch.
- The previous `active` run for the same `(metricKey, grain, horizon)` is set
  to `status: "superseded"`, `supersededBy: newRunId`, in the same batch. Old
  runs are **never deleted** — a board pack from March must still resolve the
  forecast it printed.
- Forecast points never touch `north_snapshots`. Different tables, different
  permissions, different immutability. Actuals and projections cannot be
  confused by a mis-joined query because there is no join that would do it.
- Nightly: the scheduled handler at `apps/api/src/index.ts:194` gains
  `if (isBackupWindow) await runForecasts(ctx)` immediately after
  `runSnapshotter(ctx)`, re-running every metric with an active run. So the
  forecast is always at most 24h stale and always based on closed periods.

### H.5 Variance reporting — actuals vs forecast

`GET /v1/north/forecasts/:runId/variance?period=…`, permission
`north:forecasts:read`. Joins `north_forecast_points` to `north_snapshots` on
`(metricKey, grain, period, dimsHash)` where `period_state = "closed"`, and
returns per period:

| Field | Meaning |
|-------|---------|
| `actual` | the closed snapshot |
| `p10`, `p50`, `p90` | as forecast, from the immutable run |
| `varianceMinor` | `actual − p50` |
| `varianceBp` | signed, against p50 |
| `withinBand` | `p10 ≤ actual ≤ p90` |
| `attribution` | the §G decomposition of `actual − p50` down the driver tree |
| `runId`, `runCreatedAt`, `method`, `params` | so the reader can see what was assumed |

**Coverage as a self-check.** Across all closed periods of all active runs,
the share of actuals inside the p10–p90 band should be near 80%. The Forecast
tab shows the realised coverage. Coverage of 100% means the bands are useless;
coverage of 40% means the model is wrong. This is the one number that tells a
CFO whether to trust the rest, and it is on the screen rather than in a report
nobody runs. A coverage below 50% over ≥ 12 evaluated points raises a
`north.forecast.miscalibrated` anomaly at `warn`.

### H.6 Forecast is never AI-generated

The model is not in this path. The gateway is used only to *narrate* a forecast
(§I.5), and the narration is subject to `verifyNumericClaims` against the
forecast points, exactly as a briefing is against a snapshot. The numbers come
from arithmetic in `packages/core`.

---

## I. Scenarios

### I.1 What a scenario is, as data

A **scenario** (`north_scenarios`, exists at `schema/north.ts:87-102`) is
identity: a question in the author's words, who owns it, who it is shared with.

A **scenario run** (`north_scenario_runs`, new) is a computation: a named base
forecast run, an ordered list of assumption deltas, the resulting distribution,
and the primitives used.

An **assumption** is:

```ts
interface Assumption {
  driverKey: string;                 // must be a leaf of the base run's driver tree
  kind: "multiply" | "add" | "set";
  valueBp?: number;                  // for multiply: 11000 = +10%
  valueMinor?: number;               // for add / set
  appliesFrom: string;               // period
  appliesTo: string;                 // period
  note: string;                      // required. an unexplained assumption is not an assumption
  primitiveKey?: string;             // if the delta is derived from a registered primitive
}
```

`note` is `notNull` in the JSON schema and validated by zod. §2.4 of the module
doc requires "assumptions listed"; a list of unlabelled multipliers is not a
list of assumptions.

### I.2 Model primitives

`docs/modules/north.md` §2.4: scenarios are "composed from registered model
primitives (elasticities, funnel rates, cohort retention)". Registry:
`packages/core/src/north-primitives.ts`.

```ts
interface Primitive {
  key: string;                    // "elasticity.price_to_bind_rate"
  kind: "elasticity" | "funnel_rate" | "retention" | "seasonality";
  valueBp: number;
  ciLowBp: number;
  ciHighBp: number;
  source: "fitted" | "manual";
  fittedFromJson: string | null;  // which snapshot periods it was fitted from
  fittedAt: number | null;
  note: string;
}
```

Primitives are stored per tenant in `north_metrics`-adjacent config — concretely
as rows in `north_alert_rules`-style config? No: they live in a `primitivesJson`
blob on the tenant's NORTH config, seeded with fitted defaults, editable from
NORTH Admin under `north:metrics:write`. **No new table** — there are at most a
few dozen of them and they are configuration, not records. Every scenario run
copies the primitives it used into `primitivesJson` so a scenario from March
still explains itself after the elasticity is re-fitted in June.

When a primitive has a confidence interval, the scenario run propagates it: the
p10/p90 of a scenario is the base run's band widened by the primitive's CI
applied to the affected drivers. That is how a scenario answers with a range
rather than a number.

### I.3 Forking from actuals — and never writing to them

```
POST /v1/north/scenarios/:id/run
  { baseForecastRunId, assumptions: Assumption[] }
  permission: north:scenarios:run
```

The engine:

1. Loads the base `north_forecast_runs` row and its points. **Read-only.**
2. Loads the driver tree and each leaf's projected path from
   `driverContribJson`.
3. Applies each assumption in order to the named leaf, within its period range.
4. Recomposes up the tree with the same §G code.
5. Widens the band by the primitives' CIs.
6. Inserts **one** `north_scenario_runs` row and updates
   `north_scenarios.latest_run_id`.

**Structural guarantees that a scenario cannot write actuals**, in order of how
hard they are to defeat:

1. The scenario engine module imports no writer for `north_snapshots` or
   `north_forecast_points`. There is no code path.
2. `north_snapshots` is `immutable: true` in the CRUD registry
   (`resources.ts:522`), so even the generic layer refuses.
3. Task T20's test runs a scenario and asserts `count(north_snapshots)`,
   `max(north_snapshots.ts)` and `count(north_forecast_points)` are all
   unchanged. That test is the guarantee that survives a refactor.
4. Scenario results are stored in a different table with a different id prefix
   (`scr`), so a scenario number cannot be mistaken for an actual in a query
   result, a log line, or a CSV.

### I.4 Comparing two scenarios

```
POST /v1/north/scenarios/compare { runIds: [a, b] }
  permission: north:scenarios:read
```

Refuses with 400 `scenario_base_mismatch` if the two runs have different
`baseForecastRunId`. Two scenarios forked from different bases differ for
reasons that have nothing to do with their assumptions, and presenting that
difference as a comparison is the most expensive kind of chart.

Response:

| Section | Content |
|---------|---------|
| `assumptionDiff` | assumptions in A only, in B only, in both with different values |
| `series` | per period: `a.p10/p50/p90`, `b.p10/p50/p90`, `deltaP50`, `bandsOverlap` |
| `byDriver` | the §G decomposition of `b.p50 − a.p50` |
| `base` | the base run's id, method, params, and its own p50 for reference |

`bandsOverlap` is shown per period because two scenarios whose bands overlap
everywhere have not actually been distinguished, and the screen says so in
words: "these two scenarios are not distinguishable at this confidence."

### I.5 The AI in a scenario

One gateway call, `purpose: "scenario.narrate"`, `tier: "reasoning"`,
`module: "north"` — same shape as `narrator.ts:167-225`. Input: the scenario
result, the assumptions with their notes, the primitives with their CIs.
Output: prose, run through `verifyNumericClaims` against the scenario's own
points before it is stored in `narrativeText`. Verification failure stores the
prose with a `verified: false` marker and the UI renders it greyed with the
failed claims underlined — the same fail-loudly posture as
`narrator.ts:197-210`.

The model never chooses an assumption and never computes a number.

---

## J. Decisions — the anomaly → decision → outcome loop (P2)

### J.1 What exists and why it dead-ends

`apps/web/app/routes/north-brief.tsx:294-298` handles intent `own-anomaly` by
`PATCH`-ing the anomaly to `{ state: "action_created", explainedBy: owner }`.
The state literally says an action was created. No action was created. There is
no route that creates one, no screen that lists one, and
`north_decisions` — the table designed for exactly this — has never been
written to by anything but the seed.

### J.2 The loop

```
snapshotter detects            north_anomalies row, state = "new"
   │                           emit north.anomaly.detected
   ▼
exec explains (optional)       POST /anomalies/:id/explain      north:ai:invoke
   │                           gateway call, driver tree attached,
   │                           result -> driver_analysis_json + explanation_ai_audit_id
   ▼
exec owns                      PATCH /anomalies/:id { state: "explained", explainedBy }
   │                                                            north:anomalies:assign
   ▼
exec opens a decision          POST /anomalies/:id/decision     north:anomalies:assign
   │                           creates north_decisions (status "draft",
   │                           anomaly_id set), sets anomaly.decision_id
   │                           and anomaly.state = "action_created"
   │                           — the state now means what it says
   ▼
options recorded, one chosen   POST /decisions/:id/transitions { to: "proposed", chosen }
   │                                                            north:decisions:write
   ▼
approval requested             POST /decisions/:id/transitions { to: "pending_approval" }
   │                           gate("north.decision_commit", expectedImpactMinor)
   ▼
board member approves          approvals flow                   north:decisions:approve
   ▼
exec commits                   POST /decisions/:id/transitions { to: "committed" }
   │                           emit north.decision.committed
   │                           anomaly.state -> "explained", resolved_at set
   ▼
review_at falls due            scheduled: emit north.decision.review_due
   │                           + a task on the owner (same idiom as
   │                           orbit's sweepRenewals, index.ts:190)
   ▼
outcome recorded               POST /decisions/:id/transitions { to: "reviewed" }
                               actual_impact_minor computed from
                               expected_impact_metric_key over the window,
                               NOT typed by the owner
```

### J.3 The outcome is measured, not asserted

`expected_impact_metric_key`, `expected_impact_minor` and `expected_impact_by`
are set when the decision is proposed. At review, the engine reads the
snapshots for that metric across `[committed_at, expected_impact_by]`, computes
the movement against the §H forecast that was active at commit time — i.e.
against what would have happened anyway — and writes
`actual_impact_minor = actual − counterfactual_p50`.

This is the only honest way to score a decision, and it falls out of already
having §H: without a forecast, "the metric went up after we acted" is not
evidence. The variance machinery in H.5 does the arithmetic; the decision
review just names the window.

`outcome_review_json` stores the working: the counterfactual p50, the actual,
the driver attribution of the difference, and the forecast run id.

### J.4 Human-in-the-loop (CLAUDE.md §4)

Committing a decision is `consequential: true`. The gate is
`north.decision_commit` (§B.6), decided by `north:decisions:approve`,
`dualControl: "above_threshold"` at 100 000 minor units of
`expectedImpactMinor`. Above the threshold the approver may not be the
requester — `approvals.ts` enforces that for `above_threshold` policies.

A decision whose chosen option is itself a regulated action (a price change, a
claims-guidance change, an outbound campaign) does **not** execute here. NORTH
records the decision and emits `north.decision.committed`; the owning module
picks it up and applies its own gate — `axis.price_match`,
`signal.campaign_launch`, `dist.rate_change`, each already in
`APPROVAL_POLICIES`. NORTH never becomes a back door around another module's
approval. Task T19 asserts that a committed NORTH decision writes no row in any
non-NORTH table.

### J.5 Audit trail

Per transition, three writes in one statement batch:

1. `north_decision_events` — `seq`, `kind`, `fromStatus`, `toStatus`,
   `actorRef`, `approvalId`, `payloadJson`, `at`. The unique index on
   `(tenantId, decisionId, seq)` makes concurrent transitions safe.
2. `north_decisions` projection update.
3. `audit(ctx, { action: "north.decision.<kind>", subjectRef: decisionId,
   before, after })` — the platform-wide audit log, same call
   `routes/north.ts:96-100` already makes for board packs.

Plus `emit()` for `north.decision.committed` and `north.decision.reversed`.

The Decisions screen renders the event log as a timeline. "Who approved this
and when" is one click from the decision, which is the question that gets asked
in the room.

### J.6 Review nag

`docs/modules/north.md` §2.6: "decision log with review-date nag". The
scheduled handler (`apps/api/src/index.ts:180-200`) gains
`await nagDecisionReviews(ctx)` alongside `sweepRenewals`: any `committed`
decision whose `review_at` has passed and which has no `outcome_recorded` event
gets one `north.decision.review_due` emission and one task for its owner, both
idempotent on `(decisionId, reviewAt)` so a decision left unreviewed for a
month produces one nag, not thirty.

---

## K. The eight screens

`docs/modules/north.md` §4 names eight. One exists. All eight are registered in
`apps/web/app/routes.ts` (which today has exactly one NORTH entry at `:57`).

Every screen: bilingual label table in the file (the pattern
`north-brief.tsx:67-148` already establishes), labels resolved through
`labelsFrom` from `north-shared.tsx:18-32`, permission-missing sections dropped
via `readable()` (`north-shared.tsx:39-46`) rather than erroring the page,
logical CSS properties only, WCAG 2.2 AA, and no hard-coded industry nouns —
metric names come from `north_metrics.name_json` via `metricName`
(`north-shared.tsx:100-108`) and everything else from the domain pack.

### K.1 Today — `/north/today` → `routes/north-today.tsx`

The exec home. Replaces `/north/brief` as the landing page; `/north/brief`
stays as the briefing detail.

| Block | Shows | Source |
|-------|-------|--------|
| Headline strip | 4–6 pinned metrics, value + delta chip + sparkline | `POST /explore` (closed) + the open MTD row, labelled "N of M days" |
| Today's brief | the ✦-marked narrative, ≤400 words, in the actor's locale | `GET /briefings?date=today` |
| Open anomalies | severity-ordered, each with a one-line baseline explanation | `GET /anomalies?state=new` |
| Decisions needing you | awaiting your approval, or your review is overdue | `GET /decisions?owner=me` |
| Forecast strip | this quarter's p50 with band, and realised coverage | `GET /forecasts/latest` |

Export: none (it is a dashboard). Permission: `north:briefings:read` for the
brief block; each other block independently gated and independently droppable.
AI grammar: one ✦ on the narrative, one on each anomaly explanation, each with
an inspectable "why" popover — no modals (docs/15).

### K.2 Metric Explorer — `/north/metrics` → `routes/north-metrics.tsx`

Fixes the dead link at `north-brief.tsx:487`.

| Block | Shows | Source |
|-------|-------|--------|
| Metric picker | up to 20 metrics, searchable, restricted ones absent for those without clearance (§B.5) | `GET /metrics` |
| Chart | one line per metric, normalised to bp when units differ | `POST /explore` |
| **Definition annotations** | a vertical rule at each `effective_from` with the change note on hover — `docs/modules/north.md` §8 criterion 4 | `GET /metrics/:key/versions` |
| Dimension drill | expand a metric into its `dimsHash` splits; splits sum to the headline | `POST /explore` with `includeDims` |
| Driver panel | the §G decomposition between the two selected periods | `POST /drivers/decompose` |
| Tie-out badge | `ok` / `drift` / `n/a` per money metric, linking to the ledger report | `GET /tieouts?metricKey=` |

Export: CSV and XLSX of the visible series, via the existing `ReportTable` →
export path. Permission: `north:snapshots:read` (+ `north:metrics:read`).

### K.3 Anomalies — `/north/anomalies` and `/north/anomalies/:id` → `routes/north-anomalies.tsx`, `routes/north-anomaly.tsx`

Fixes the dead link at `north-brief.tsx:459`.

List: filter by state, severity, metric, period. Ordered severity then
`detected_at`.

Detail — the important one:

| Block | Shows |
|-------|-------|
| Header | metric, period, actual vs baseline, signed delta, severity, method used |
| **Why this is unusual** | the `baseline_json` rendered as a small table: every period read, its value, the median, the MAD, the seasonal index, the z-score. Not prose. Data. |
| Driver attribution | the §G tree with contributions and the zero residual visible |
| ✦ Explanation | the gateway explainer's paragraph, with each cited number linked to the snapshot it came from |
| Actions | Own · Dismiss (reason required) · **Open a decision** |
| Linked decision | if `decision_id` is set, the decision's current status and timeline |

Export: PDF of the detail. Permission: `north:anomalies:read`; actions need
`north:anomalies:assign`.

### K.4 Scenarios — `/north/scenarios`, `/north/scenarios/:id` → `routes/north-scenarios.tsx`, `routes/north-scenario.tsx`

Fixes the dead link at `north-brief.tsx:370` (`/north/whatif` → redirect to
`/north/scenarios`, so an old bookmark does not 404).

| Block | Shows |
|-------|-------|
| Scenario list | question, author, latest run date, shared-with |
| Base picker | which forecast run this forks; its method, params and fit quality shown inline |
| Assumption editor | add/edit/reorder assumptions; each row shows the driver, the delta, the period range, the required note, and the primitive it came from with its CI |
| Result | fan chart: base p50 dotted, scenario p10–p90 shaded, p50 solid |
| Assumptions table | printed under every result, always. §2.4. |
| ✦ Narrative | verified against the scenario's own points |
| Compare | pick a second run with the same base; renders §I.4 |

Export: XLSX (periods × p10/p50/p90 for base and scenario) and PDF.
Permission: `north:scenarios:read`; running needs `north:scenarios:run`.
The screen states, in a line under the result, "scenario — not an actual", and
the values are rendered in a distinct type colour from actuals everywhere they
appear.

### K.5 Board Room — `/north/board` → `routes/north-board.tsx`

Fixes the dead link at `north-brief.tsx:363`.

| Block | Shows |
|-------|-------|
| Pack list | period, title, status (`draft`/`review`/`final`/`distributed`), who approved |
| Pack preview | the assembled `ReportTable[]` rendered as HTML before the PDF exists |
| **Excluded metrics footnote** | every metric left out for not being board-safe (§E.2), named, with its tie-out status |
| Generate | one click → `POST /boardpacks` (already exists, `routes/north.ts:52`) |
| Approve & distribute | gated; status may not reach `final` without it |

Export: PDF (exists), XLSX (new, same `ReportTable[]`).
Permission: `north:boardpacks:read`; generate needs `north:boardpacks:generate`.
`docs/modules/north.md` §7 wants pack assembly under 10 minutes; the current
route already assembles synchronously, so the KPI is a measurement, not a
build.

**Fixes to `north-boardpack.ts` this screen forces:** its column labels are
hard-coded English strings ("Metric", "Delta (bps)", "Review by") — they become
i18n keys resolved in the requesting actor's locale. And it selects the latest
`exec` briefing regardless of period, which the file's own comment admits; it
gains a period-bounded lookup with an explicit "no briefing in this period"
row rather than silently borrowing last quarter's.

### K.6 Decisions — `/north/decisions`, `/north/decisions/:id` → `routes/north-decisions.tsx`, `routes/north-decision.tsx`

| Block | Shows |
|-------|-------|
| List | title, owner, status, review date, expected impact, **overdue review** badge |
| Detail header | the anomaly it came from, with a link back |
| Options | each option with its expected impact; the chosen one marked |
| Timeline | `north_decision_events`, one row per transition, with actor, time and approval id |
| Approval | who approved, when, under which policy and threshold |
| Outcome | expected vs counterfactual vs actual, with the driver attribution of the difference |
| Actions | transition buttons, each shown only if the state machine and the actor's permissions both allow it |

Export: CSV of the decision log (a board asks for this every quarter).
Permission: `north:decisions:read`; transitions need `north:decisions:write`;
approve needs `north:decisions:approve`.

### K.7 NORTH Admin — `/north/admin` → `routes/north-admin.tsx`

Tabs:

1. **Metrics** — definition, unit, grain, `source_kind`, `ledger_tie_json`,
   `baseline_method`, `driver_tree_key`, sensitivity, owner, target. Editing
   requires a change note and appends a version.
2. **Tie-out** — §E.4. The CFO tab.
3. **Data health** — `GET /data-health` (exists, `routes/north.ts:145`) plus,
   per metric, its last closed period, whether a tie-out exists, and whether it
   has enough history to leave baseline cold start.
4. **Alert rules** — CRUD on `north_alert_rules` under `north:alerts:write`,
   a key declared since day one and used by no screen.
5. **Primitives** — the elasticities and funnel rates, their CIs, their
   `fittedAt`, and a re-fit button.
6. **Backfill** — run `POST /snapshotter/backfill` over a period range, with a
   progress readout.

Permission: `north:metrics:read` to view; each mutation on its own key.

### K.8 NORTH Dev — `/north/dev` → `routes/north-dev.tsx`

For the people who have to debug a number at 23:00.

| Block | Shows |
|-------|-------|
| Snapshotter runs | last N runs, per-metric duration, rows written, errors |
| Forecast fits | per run: α, β, φ, MASE, holdout size, realised coverage |
| Baseline inspector | pick metric + period, see exactly what `baselineFor` returned, including the observation list |
| Eval status | last `pnpm eval` result per NORTH task directory, with the Arabic share |
| Gateway calls | the `ai_audit_log` rows for `module = "north"`, with purpose, tier, tokens, cost, and the verification outcome |
| Event stream | the `north.*` envelopes in the outbox, published or not |

Permission: `north:metrics:read` + `north:snapshots:run` (i.e. analyst and
admin, not board). No export.

### K.9 Route registrations

`apps/web/app/routes.ts`, replacing the single entry at `:57`:

```
route("north/today",           "routes/north-today.tsx"),
route("north/brief",           "routes/north-brief.tsx"),
route("north/metrics",         "routes/north-metrics.tsx"),
route("north/anomalies",       "routes/north-anomalies.tsx"),
route("north/anomalies/:id",   "routes/north-anomaly.tsx"),
route("north/scenarios",       "routes/north-scenarios.tsx"),
route("north/scenarios/:id",   "routes/north-scenario.tsx"),
route("north/board",           "routes/north-board.tsx"),
route("north/decisions",       "routes/north-decisions.tsx"),
route("north/decisions/:id",   "routes/north-decision.tsx"),
route("north/admin",           "routes/north-admin.tsx"),
route("north/dev",             "routes/north-dev.tsx"),
```

Plus a redirect `north/whatif` → `north/scenarios`.

---

## L. API surface

Existing five (unchanged in shape): `POST /briefings/generate`,
`POST /boardpacks`, `POST /snapshotter/run`, `POST /explore`,
`GET /data-health` (`apps/api/src/routes/north.ts:31, 52, 110, 125, 145`).

New bespoke routes, all in `apps/api/src/routes/north.ts`, all mounted before
generic CRUD for the same paths (the reason is already documented at
`routes/north.ts:46-51`):

| Method | Path | Permission | Body / query | Returns |
|--------|------|-----------|--------------|---------|
| POST | `/snapshotter/backfill` | `north:snapshots:run` | `{from, to, metricKeys?}` | `{queued: n}` |
| POST | `/drivers/decompose` | `north:snapshots:read` | `{metricKey, grain, period, comparePeriod?, dim?}` | §G.5 shape |
| POST | `/anomalies/:id/explain` | `north:ai:invoke` | `{}` | `{text, aiAuditId, verified}` |
| POST | `/anomalies/:id/decision` | `north:anomalies:assign` | `{title, options[], expectedImpactMetricKey, expectedImpactMinor, expectedImpactBy, reviewAt}` | the decision row |
| POST | `/decisions/:id/transitions` | `north:decisions:write` (+ `:approve` for the approve step) | `{to, chosen?, reason?, approvalId?}` | `{decision, event}` |
| GET | `/decisions/:id/events` | `north:decisions:read` | — | `{events: []}` |
| POST | `/forecasts/run` | `north:forecasts:run` | `{metricKey, grain, horizon, method?}` | the run + points |
| GET | `/forecasts/latest` | `north:forecasts:read` | `?metricKeys=&grain=` | active runs + points |
| GET | `/forecasts/:runId/variance` | `north:forecasts:read` | `?period=` | §H.5 shape |
| POST | `/scenarios/:id/run` | `north:scenarios:run` | `{baseForecastRunId, assumptions[]}` | the scenario run |
| POST | `/scenarios/compare` | `north:scenarios:read` | `{runIds:[a,b]}` | §I.4 shape |
| GET | `/tieouts` | `north:metrics:read` | `?metricKey=&period=&status=` | `{rows: []}` |
| GET | `/metrics/:key/versions` | `north:metrics:read` | — | `{versions: []}` |

`/explore`'s grain enum narrows from `["day","week","month"]`
(`routes/north.ts:118`) to `["day","month"]`, and gains
`includeDims?: boolean` and `periods?: string[]` (max 400) so the Metric
Explorer can draw a line instead of issuing one request per point.

Every new route is added to the OpenAPI document in `packages/sdk` in the same
PR that adds it — CLAUDE.md definition of done.

---

## M. Evals

`packages/model-gateway/evals/`. Convention (verified at
`packages/model-gateway/evals/run.ts:313-321`, `:336`): one directory per task
with `cases.jsonl` and `thresholds.json`, and a scorer registered in the
`SCORERS` map at `:303-311`. **A directory with no registered scorer is
silently skipped** — so every new directory below ships with its `SCORERS`
entry in the same commit, and task T27 adds a meta-test that asserts every
directory under `evals/` has a scorer, which closes F10's silent-skip hole for
good.

### M.1 `evals/north` — extended from 10 to 26 cases

Current: 10 cases, all English, five clean / five fabricated across money,
percent, count, duration and multi-metric. Thresholds `recallMin: 1.0`,
`falsePositiveMax: 0`.

New composition:

| Family | n | Locale | What it asserts |
|--------|---|--------|-----------------|
| money clean / fabricated | 2 / 2 | en | (existing) |
| percent clean / fabricated | 2 / 2 | en | (existing) |
| count clean / fabricated | 1 / 1 | en | (existing) |
| duration clean / fabricated | 1 / 1 | en | (existing) |
| multi-metric clean / fabricated | 1 / 1 | en | (existing) |
| **Arabic, Western digits, clean / fabricated** | 2 / 2 | ar | Arabic prose with `4,312.00` — the ordinary case |
| **Arabic-Indic digits, clean / fabricated** | 2 / 2 | ar | `٤٬٣١٢٫٠٠` — U+0660–U+0669, U+066B decimal, U+066C thousands |
| **Arabic with RTL marks around a number** | 1 / 1 | ar | U+200F / U+061C adjacent to digits must not break extraction |
| **Arabic percent with the Arabic percent sign** | 1 / 1 | ar | U+066A `٪` |
| **bare-year false-negative probe** | 0 / 2 | en, ar | a fabricated figure that happens to equal a fragment of the period string |

Totals: 26 cases, **11 Arabic** = 42.3%, above the 40% floor
`gap-signal-design.md` sets and this spec adopts.

`thresholds.json`:

```json
{
  "recallMin": 1.0,
  "falsePositiveMax": 0,
  "arabicCaseMin": 0.40
}
```

**These cases will fail on day one, and that is the point.**
`packages/core/src/narrator-verify.ts:47` is `/\d[\d,]*(?:\.\d+)?/g` — ASCII
digits only. An Arabic briefing written with Arabic-Indic digits extracts
**zero** numbers, so `verifyNumericClaims` returns `ok` vacuously and a
fabricated Arabic figure sails through. `docs/modules/north.md` §8 requires the
brief nightly "in en+ar" with "100% numeric claims machine-verified"; today the
Arabic half of that is unverified in a way nobody has noticed because nobody
wrote an Arabic case. The four Arabic-Indic cases are the failing test; T2
normalises U+0660–U+0669, U+06F0–U+06F9, U+066B, U+066C and U+066A before
extraction.

The bare-year probe targets `narrator-verify.ts:53-73`, where `acceptablePool`
pushes **every dash-separated part of every period string**. For period
`2026-01`, both `2026` and `1` are permanently acceptable numbers, so a
sentence claiming "1 policy was issued" passes regardless of the snapshot. The
fix is to accept period fragments only when they appear adjacent to a
recognised date pattern in the text, not as free-floating numerals.

### M.2 `evals/north-anomaly` — new, the anomaly explainer

`scoreNorthAnomaly` registered in `SCORERS`.

Case shape:

```jsonl
{"id":"cac-spike-en","locale":"en","anomaly":{...},"baseline":{...},
 "drivers":[...],"text":"...","expect":{"citesBaselineMethod":true,
 "citesTopDriver":"channel=paid.spend","numericClaimsOk":true,
 "attributesCause":true,"overclaims":false}}
```

Four scored metrics:

| Metric | Definition | Threshold |
|--------|-----------|-----------|
| `numericAccuracy` | share of cases where `verifyNumericClaims` passes against the anomaly's own baseline snapshot | ≥ 1.0 |
| `driverRecall` | share where the explanation names the largest-contribution driver | ≥ 0.85 |
| `causalOverclaim` | share where the explanation asserts causation the driver tree does not support (an accounting identity is not a cause) | ≤ 0.10 |
| `arabicShare` | Arabic cases / all cases | ≥ 0.40 |

20 cases, 9 Arabic (45%). Families: the seeded CAC spike from
`docs/modules/north.md` §8 in both locales; a cold-start anomaly where the
correct answer is "not enough history to say"; a month-boundary case that the
current detector would have fired on and the new one must not; a
ledger-tie-drift anomaly where the explanation must say the number disagrees
with the general ledger rather than invent a business cause; a mix-shift case
where the naive reading ("the rate fell") is wrong and the mix decomposition
shows why.

The `causalOverclaim` metric is the one that matters and the one that will be
uncomfortable. An anomaly explainer that says "CAC rose **because** paid spend
rose" when the tree only shows paid spend as the largest arithmetic contributor
is overclaiming — the tree is an identity, not a causal model. The prompt must
distinguish "the movement is arithmetically attributable to X" from "X caused
it", and the eval scores that distinction against a curated list of causal
verbs per locale.

### M.3 `evals/north-tieout` — new, the eval that would have caught F49

The existing `evals/north` suite scores prose against a snapshot. F49 is a bug
in the snapshot. **No amount of prose verification can catch it**, which is
precisely why F49 survived a suite at recall 1.0. So this directory scores a
different function.

New export from `packages/core`: `verifyLedgerTie(text, snapshot, tieouts)`.
It refuses any money claim in the text about a metric whose latest tie-out for
that period is `drift` or `missing`, and any money claim about a metric whose
`source_kind` is `operational` when the audience is `board` or `investor`.

Case shape:

```jsonl
{"id":"f49-net-commission-clawback","locale":"en","audience":"board",
 "text":"Net commission for December was AED 43,120.",
 "snapshot":{"net_commission":{"value":4312000,"unit":"money","sourceKind":"operational"}},
 "tieouts":[{"metricKey":"net_commission","period":"2025-12",
             "metricValueMinor":4312000,"ledgerValueMinor":3980000,
             "diffBp":834,"toleranceBp":0,"status":"drift"}],
 "expectOk":false}
```

That case is F49 reduced to fifteen lines. Today's pipeline passes it — the
prose matches the snapshot exactly. `verifyLedgerTie` fails it, because the
snapshot does not match the ledger.

16 cases, 7 Arabic (43.75%). Families:

| Family | n | What it asserts |
|--------|---|-----------------|
| ledger metric, tie `ok`, prose matches | 3 | no false positives |
| ledger metric, tie `drift` | 3 | refused (**the F49 case**) |
| money metric, **no tie-out row at all** | 2 | refused — silence is not evidence |
| operational money metric, `exec` audience | 2 | allowed, but flagged `operational` |
| operational money metric, `board` audience | 2 | refused (§E.2 enforcement) |
| non-money metric, no tie-out | 2 | allowed, tie-out is not applicable |
| Arabic-Indic digits + drift | 2 | the two failure modes compose |

`thresholds.json`: `{"recallMin": 1.0, "falsePositiveMax": 0, "arabicCaseMin": 0.40}`.

### M.4 Shared Arabic-share scoring

`run.ts` gains a helper used by all three NORTH directories:

```ts
function arabicShare(cases: Array<{ locale?: string }>): number
```

emitted as a `metric("arabicShare", …, { min: thresholds.arabicCaseMin })`
whenever `arabicCaseMin` is present in a directory's thresholds. Adding the key
to `evals/axis`, `evals/signal`, `evals/compliance`, `evals/injection` and
`evals/axis-copilot` is out of scope here but is the obvious follow-on for F46
as a whole, and the helper is written to be reused rather than copied.

### M.5 Eval-first ordering

CLAUDE.md: "AI features are eval-first. Before writing any prompt, agent, or
model integration: author the golden set + thresholds." So T2 (Arabic cases),
T5 (tie-out eval) and T16 (anomaly explainer eval) each land **before** the
code that makes them pass, and each is committed red.

---

## N. Where the existing code fights this design

Eighteen concrete places. Each is a real contradiction, not a style opinion.

1. **The anomaly baseline is the same period's previous write.**
   `apps/api/src/engines/north-snapshotter.ts:305` — `const prevValue =
   existing?.value;` where `existing` came from the upsert lookup at `:261-272`
   keyed on the identical `(tenant, metricKey, grain, period, dimsHash)`. Day
   grain never fires; month grain false-fires every 1st. This is F48 and it is
   one line.

2. **Two engines already disagree about what "previous" means.**
   `apps/api/src/engines/narrator.ts:83-88` builds its comparison from
   `previousDay` / `previousMonth` — correctly. So a briefing generated the same
   night as a snapshot can say a metric is flat while `north_anomalies` says it
   moved 10 000 bp. Fixing (1) also fixes this divergence; not fixing it leaves
   two sources of truth in one module.

3. **Financial metrics never read the ledger.**
   `north-snapshotter.ts:105-113` (`gwp` = `sum(axisPolicies.premiumMinor)`) and
   `:115-123` (`netCommission` = `sum(axisPolicies.commissionMinor)`), both
   windowed on `axisPolicies.createdAt`. `packages/ledger/src/reports.ts:475`
   already computes the real figure and nothing calls it from NORTH. F49.

4. **`net_commission` is not net of anything.** The channel's share is a credit
   to `2100` (`packages/core/src/seed/ledger.ts:657`) and a clawback is a debit
   to `4000`/`2100` (`:672-674`). Neither touches
   `axis_policies.commission_minor`, so the metric named "net commission" is
   gross commission before shares and before reversals.

5. **Decisions are freely mutable.** `apps/api/src/resources.ts:545` registers
   `rw("north:decisions")`, so a `PATCH` can rewrite `chosen`, `status` and
   `outcome_review_json` with no history, no approval and no audit beyond the
   generic CRUD entry. §C.4 requires append-only.

6. **`verifyNumericClaims` cannot read Arabic numerals.**
   `packages/core/src/narrator-verify.ts:47` — `NUMBER_RE =
   /\d[\d,]*(?:\.\d+)?/g`. An Arabic-Indic-digit briefing extracts zero numbers
   and passes vacuously, while `docs/modules/north.md` §8 requires the brief in
   en **and** ar with 100% of numeric claims machine-verified.

7. **The acceptable-number pool is too permissive.**
   `narrator-verify.ts:53-73` pushes every dash-separated part of every period
   string, so for period `2026-01` the numbers `2026` and `1` are unconditionally
   acceptable. Any claim landing on a small integer is unfalsifiable.

8. **The narrator's system prompt is hard-coded English with industry nouns.**
   `apps/api/src/engines/narrator.ts:132-135`. CLAUDE.md §14 forbids hard-coded
   industry vocabulary; §7 requires the brief in the exec's locale, and a
   locale-neutral prompt is a prerequisite for a genuinely Arabic brief rather
   than an English brief with Arabic words.

9. **The narrator silently skips week grain.** `narrator.ts:77` with a
   `ponytail:` comment. Correct behaviour today, but it means a metric declared
   at week grain in `north_metrics` (the schema allows it, `schema/north.ts:17`)
   is invisible in the brief with no warning anywhere.

10. **`/explore` accepts a grain nothing produces.**
    `apps/api/src/routes/north.ts:118` — `z.enum(["day","week","month"])`.
    A caller asking for `week` gets an empty array and no explanation.

11. **Two declared events have never fired.** `docs/04-api.md:80` publishes
    `north.anomaly.detected` and `north.briefing.published` to webhook
    subscribers. The only `emit` in NORTH is `north.alert.triggered`
    (`north-snapshotter.ts:298`). Every tenant that subscribed to the anomaly
    webhook has received nothing and has no way to know.

12. **`afterWrite` has no `env`.** `apps/api/src/crud.ts:124` types it
    `(ctx, row, action)` while `beforeWrite` at `:118` gets
    `(ctx, values, existing, env)`. The metric-version append (§C.2) works
    within that limit because it only needs `ctx.db`, but any generic-CRUD hook
    that must push realtime or enqueue cannot. Same finding as
    `gap-orbit-design.md` §5.

13. **Board pack column labels are hard-coded English.**
    `apps/api/src/engines/north-boardpack.ts` — `"Metric"`, `"Delta (bps)"`,
    `"Note"`, `"Review by"`, `"Executive briefing highlights"`, `"Open
    decisions"`. A board pack for an Arabic-locale tenant renders English
    headers over Arabic content. CLAUDE.md §7.

14. **The board pack borrows a briefing from outside its period.**
    `north-boardpack.ts` selects the latest `exec` briefing ordered by date with
    no period bound, and its own comment says so. A Q1 pack can print Q4
    highlights with no indication that it did.

15. **Owning an anomaly claims an action that does not exist.**
    `apps/web/app/routes/north-brief.tsx:294-298` PATCHes
    `{state: "action_created"}`. There is no action, no route that makes one,
    and no screen that would show one. P2.

16. **Four links on the only NORTH screen 404.**
    `north-brief.tsx:363` (`/north/board`), `:370` (`/north/whatif`), `:459`
    (`/north/anomalies/:id`), `:487` (`/north/metrics?q=`) against
    `apps/web/app/routes.ts:57`, which registers `north/brief` and nothing else.

17. **The snapshotter computes exactly two periods and cannot backfill.**
    `north-snapshotter.ts:30-37`. Seasonal baselines need 8 same-weekday
    observations or 24 months; a tenant reaches that only by waiting, and a
    metric added today has no history at all. Compounded by
    `apps/api/src/index.ts:194`, which runs the snapshotter only inside the UTC
    02:00–02:15 backup window — one attempt per day, and a failed run silently
    costs a day of history.

18. **A metric definition change is silent and irreversible.**
    `apps/api/src/resources.ts:520` registers metrics as `rw`, so editing
    `definition_sql_ref` overwrites the old definition with no version, no
    effective date and no annotation — directly contradicting
    `docs/modules/north.md` §8's "metric definition change shows as a chart
    annotation", which is an acceptance criterion, not a nice-to-have.

Also relevant, and already recorded elsewhere:
`gap-signal-design.md` Task 18 is explicitly blocked on F48 with the failing
test name `"a month-to-date metric is not compared against its own earlier
write"`. **T3 below unblocks it.** The two specs must use the same test name so
the cross-reference stays findable.

---

## O. Implementation plan

Ordered. Each task is independently testable and starts with a failing test.
Tasks T1–T8 are the gap closures and can be delivered without any new screen;
T9–T22 are the new capability; T23–T29 are cleanup and hardening. A reviewer
should reject any of these that arrives as an implementation-only diff.

---

**T0 — the acceptance suite (write it failing, first).**
Test: `apps/e2e/north.spec.ts` → `@journey:J-E1` and
`apps/api/src/routes/north.accept.test.ts` → `@accept:M-north`.
Encode `docs/modules/north.md` §8's four acceptance criteria as failing specs:
the brief generates nightly in en and ar with 100% of numeric claims verified;
the seeded CAC-spike anomaly is detected and attributed to a driver; the board
pack PDF is one click; a metric definition change appears as a chart
annotation. Run with `--allow-fail=accept` until T22 closes.

**T1 — the closed-period rule.**
Test: `packages/core/src/north-baseline.test.ts` →
`"a month-to-date period is open until its last day has elapsed"`.
Ships `isClosed(grain, period, now)` in `packages/core/src/north-baseline.ts`
and the `period_state` column on `north_snapshots`
(`packages/db/src/schema/north.ts`) with a forward-only migration. No behaviour
change to the snapshotter yet.

**T2 — Arabic numeral extraction (eval-first, red).**
Test: `packages/model-gateway/evals/north/cases.jsonl` grows to 26 cases with
11 Arabic (§M.1), and `packages/core/src/narrator-verify.test.ts` →
`"extracts Arabic-Indic digits and the Arabic decimal separator"`.
Then fix `packages/core/src/narrator-verify.ts:47` to normalise U+0660–U+0669,
U+06F0–U+06F9, U+066B, U+066C, U+066A and strip U+200F/U+061C before matching.
Add `arabicShare` to `packages/model-gateway/evals/run.ts` and `arabicCaseMin:
0.40` to `evals/north/thresholds.json`.

**T3 — the F48 fix.**
Test: `apps/api/src/engines/north-snapshotter.test.ts` →
`"a month-to-date metric is not compared against its own earlier write"`
(**this exact name** — `gap-signal-design.md` Task 18 references it).
Plus `"a day-grain metric fires an anomaly against the prior day"`, which fails
today because day-grain detection has never fired at all.
Ships: detection restricted to `period_state = "closed"`, and the baseline read
from prior closed periods rather than from `existing` at
`north-snapshotter.ts:305`.

**T4 — snapshot immutability for closed periods.**
Test: `apps/api/src/engines/north-snapshotter.test.ts` →
`"re-running the snapshotter does not rewrite a closed period"`.
Asserts the row's `id` and `ts` are unchanged across two runs. This is the test
that makes "snapshots are immutable" true rather than declared.

**T5 — the tie-out eval (eval-first, red).**
Test: `packages/model-gateway/evals/north-tieout/cases.jsonl` (16 cases, 7
Arabic) + `thresholds.json` + `scoreNorthTieout` registered in `SCORERS` at
`packages/model-gateway/evals/run.ts:303-311`.
The suite fails because `verifyLedgerTie` does not exist yet.

**T6 — `verifyLedgerTie` and the tie-out table.**
Test: `packages/core/src/north-tieout.test.ts` →
`"a money claim about a metric whose tie-out drifted is refused"`.
Ships `packages/core/src/north-tieout.ts`, the `north_tieouts` table, the
`source_kind` / `ledger_tie_json` / `tie_tolerance_bp` columns on
`north_metrics`, and turns T5's eval green.

**T7 — `net_commission` reads the ledger. F49's core.**
Test: `apps/api/src/engines/north-snapshotter.test.ts` →
`"net commission excludes a clawed-back commission"`, seeded from the reversal
at `packages/core/src/seed/ledger.ts:672-674`.
Ships: `netCommission` at `north-snapshotter.ts:115-123` replaced by a call to
`commissionByDimension` (`packages/ledger/src/reports.ts:475`), and
`source_kind: "ledger"` on the metric.

**T8 — the remaining ledger metrics and the operational bar.**
Test: `apps/api/src/engines/north-boardpack.test.ts` →
`"a board pack excludes an operational money metric and footnotes the
exclusion"`.
Ships: `premium_collected`, `commission_receivable`, `client_money_balance`,
`revenue_recognised`, `gross_margin_bp`, `cash_collected`,
`channel_share_payable` as thin adapters over `reports.ts`; `boardSafe()`; the
filter in `north-boardpack.ts` and in `generateBriefing` for board/investor
audiences. **F49 closes here.**

**T9 — the three baseline methods.**
Test: `packages/core/src/north-baseline.test.ts` →
`"seasonal robust z compares a Tuesday to the last eight Tuesdays"`,
`"year-on-year uses 364 days so weekdays align"`,
`"fewer than six same-phase observations degrades to prior period"`.
Ships `baselineFor()` in full, pure, integer-safe. Under the Stryker ratchet.

**T10 — baselines wired, with severity and provenance.**
Test: `apps/api/src/engines/north-snapshotter.test.ts` →
`"an anomaly records the method, the baseline and every period it read"`.
Ships: the new `north_anomalies` columns, the two-condition firing rule (§F.5),
severity, and `emit("north.anomaly.detected")` — the first time that event has
ever fired.

**T11 — the driver tree, with a zero-residual property test.**
Test: `packages/core/src/north-drivers.test.ts` →
`"Shapley contributions sum exactly to the delta for any factor vector"`
(property-based, integer, includes the rounding-residual assignment).
Ships `packages/core/src/north-drivers.ts` and `DRIVER_TREES`.

**T12 — `POST /drivers/decompose` and attribution on anomalies.**
Test: `apps/api/src/routes/north.test.ts` →
`"the seeded December channel splits decompose to the headline with zero
residual"` (uses `DECEMBER_SPLITS`, `packages/core/src/seed.ts:1263+`).
Ships the route and the write into
`north_anomalies.driver_analysis_json`.

**T13 — the forecast engine.**
Test: `packages/core/src/north-forecast.test.ts` →
`"damped Holt reproduces a known series to the minor unit"`,
`"p10 and p90 come from holdout residuals, not a normal assumption"`,
`"a forecast run is refused an update"`.
Ships `packages/core/src/north-forecast.ts`, `north_forecast_runs`,
`north_forecast_points`, both `immutable: true` in `resources.ts`.

**T14 — forecast routes and nightly run.**
Test: `apps/api/src/routes/north.test.ts` →
`"running a forecast supersedes the previous active run and never deletes it"`.
Ships `POST /forecasts/run`, `GET /forecasts/latest`, and `runForecasts(ctx)`
called from `apps/api/src/index.ts` immediately after `runSnapshotter` at
`:194`.

**T15 — variance and coverage.**
Test: `apps/api/src/routes/north.test.ts` →
`"variance attributes the miss down the driver tree with zero residual"` and
`packages/core/src/north-forecast.test.ts` →
`"realised coverage below 50% over twelve points raises a miscalibration
anomaly"`.
Ships `GET /forecasts/:runId/variance`.

**T16 — the anomaly-explainer eval (eval-first, red).**
Test: `packages/model-gateway/evals/north-anomaly/` — 20 cases, 9 Arabic,
`thresholds.json` with `driverRecallMin: 0.85`, `causalOverclaimMax: 0.10`,
`arabicCaseMin: 0.40`, and `scoreNorthAnomaly` registered in `SCORERS`.

**T17 — the anomaly explainer.**
Test: `apps/api/src/routes/north.test.ts` →
`"an explanation that cites a number absent from the baseline is refused"`.
Ships `POST /anomalies/:id/explain` through the gateway
(`module: "north"`, `purpose: "anomaly.explain"`, `tier: "standard"`), the
driver tree in the prompt, `verifyNumericClaims` on the way out, and
`explanation_ai_audit_id` recorded. Turns T16 green.

**T18 — decisions become append-only.**
Test: `apps/api/src/routes/north.test.ts` →
`"PATCH on a decision is refused"` and
`"two concurrent transitions cannot claim the same sequence number"`, plus
`packages/core/src/rbac.test.ts` →
`"north.board holds no north write permission other than decisions:approve"`.
Ships: `resources.ts:545` narrowed to read+create, `north_decision_events`, the
state machine in `packages/core/src/north-decisions.ts`, and the three new
permission keys in `packages/core/src/rbac.ts` (the array ending at `:203`).

**T19 — the decision approval gate.**
Test: `apps/api/src/routes/north.test.ts` →
`"committing a decision above the impact threshold requires a second approver"`
and `"a committed NORTH decision writes no row outside the north tables"`.
Ships the `north.decision_commit` policy in
`packages/core/src/approvals.ts`, the `commit` transition, `audit()`, and
`emit("north.decision.committed")`.

**T20 — anomaly → decision, and the review nag. P2 closes here.**
Test: `apps/api/src/routes/north.test.ts` →
`"owning an anomaly and opening a decision links them both ways"` and
`"an overdue decision review nags once, not once per night"`.
Ships `POST /anomalies/:id/decision`, `nagDecisionReviews(ctx)` in the
scheduled handler beside `sweepRenewals` (`apps/api/src/index.ts:190`), and the
measured outcome computed against the counterfactual forecast (§J.3).

**T21 — scenarios.**
Test: `apps/api/src/routes/north.test.ts` →
`"a scenario run writes no snapshot and no forecast point"` (asserts row counts
and `max(ts)` unchanged — the §I.3 guarantee) and
`"comparing two scenarios with different bases is refused"`.
Ships `north_scenario_runs`, `packages/core/src/north-primitives.ts`,
`POST /scenarios/:id/run`, `POST /scenarios/compare`.

**T22 — metric versioning and the chart annotation.**
Test: `apps/api/src/routes/north.test.ts` →
`"editing a metric definition appends a version and requires a change note"`,
and the T0 acceptance spec's fourth criterion turns green.
Ships `north_metric_versions`, the `afterWrite` hook on the `metrics` resource,
`GET /metrics/:key/versions`.

**T23 — sensitivity and dimension row scoping.**
Test: `apps/api/src/crud.test.ts` →
`"a restricted metric is 404 for a board member, not 403"` and
`"a team-scoped actor sees the headline but not another team's split"`.
Ships the two `rowVisible` predicates in `apps/api/src/resources.ts` (§B.5).

**T24 — backfill, and `/explore` tells the truth about grain.**
Test: `apps/api/src/routes/north.test.ts` →
`"backfilling twenty-four months writes snapshots and tie-outs but no
anomalies"` and `"explore refuses a week grain instead of returning nothing"`.
Ships `POST /snapshotter/backfill` (queue-chunked) and narrows the enum at
`apps/api/src/routes/north.ts:118`.

**T25 — the six missing screens.** Split per screen in delivery; one task here
because they share a shape.
Test: `apps/e2e/north.spec.ts` → one spec per screen, each asserting the page
renders in `ar` with `dir="rtl"`, that every interactive element is
keyboard-reachable, and that no link on the page 404s
(`"no NORTH screen links to a route that does not exist"` — the direct fix for
the four dead links at `north-brief.tsx:363, 370, 459, 487`).
Ships all twelve route registrations in `apps/web/app/routes.ts` (§K.9), the
route modules, and a design-system story per new component.

**T26 — the board pack speaks the reader's language.**
Test: `apps/api/src/engines/north-boardpack.test.ts` →
`"board pack column labels render in the requesting locale"` and
`"a board pack with no briefing in its period says so instead of borrowing
one"`.
Fixes items 13 and 14 in §N.

**T27 — no eval directory can be silently skipped.**
Test: `packages/model-gateway/evals/run.test.ts` →
`"every directory under evals has a registered scorer"`.
Closes the `run.ts:336` hole that F10 names, permanently.

**T28 — the narrator prompt loses its hard-coded English and its industry
nouns.**
Test: `apps/api/src/engines/narrator.test.ts` →
`"the system prompt contains no industry noun outside the domain pack"`.
Rewrites `apps/api/src/engines/narrator.ts:132-135` to build the prompt from
the active domain pack and the target locale. CLAUDE.md §14 and §7.

**T29 — the period-fragment loophole in the acceptable pool.**
Test: `packages/core/src/narrator-verify.test.ts` →
`"a bare number equal to a period fragment is not automatically acceptable"`.
Fixes `packages/core/src/narrator-verify.ts:53-73`. Last because it will
surface false positives in existing briefings and wants the full eval suite
already green underneath it.

---

## Appendix: events

Emitted by NORTH after this design (`module: "north"`, envelope per
`packages/core/src/events.ts:26-36`):

| Type | Subject | When | Declared in docs/04 |
|------|---------|------|---------------------|
| `north.alert.triggered` | rule id | threshold rule fires | no (exists today, `north-snapshotter.ts:298`) |
| `north.anomaly.detected` | anomaly id | a closed period fires (§F.5) | **yes, `docs/04-api.md:80`, never fired** |
| `north.briefing.published` | briefing id | a briefing reaches `published` | **yes, `docs/04-api.md:80`, never fired** |
| `north.metric.tie_broken` | metric key | tie-out `status = "drift"` (§E.3) | new — add to docs/04 §7 |
| `north.decision.committed` | decision id | commit transition passes the gate | new — add to docs/04 §7 |
| `north.decision.review_due` | decision id | nag (§J.6) | new — add to docs/04 §7 |
| `north.decision.reversed` | decision id | reverse transition | new — add to docs/04 §7 |
| `north.forecast.published` | run id | a forecast run becomes `active` | new — add to docs/04 §7 |

Consumed by NORTH (for context, per `docs/modules/north.md:109`): every
module's events. NORTH subscribes rather than reaching into other modules'
tables, which is CLAUDE.md §6 and is already how the snapshotter is meant to
work.

The four `new` rows above are a change to `docs/04-api.md` §7 and must land in
the same PR as the code that emits them — the event catalogue is a contract
and contracts are tests (CLAUDE.md, development method §6).
