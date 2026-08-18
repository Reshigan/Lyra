# AXIS — policy & claims lifecycle design

Closes F4, F5, F13, F23–F28 and the AXIS items in P2 of
`docs/27-feature-gap-register.md`.

Scope: bind/issue, endorsement (MTA) with real versioning, cancellation, lapse,
reinstatement, NTU, renewal, FNOL intake, claims desk with reserve history,
claim payment, recovery/subrogation, document generation, bordereaux, KPIs and
the AI surfaces that sit on top.

Governing constraints (`CLAUDE.md`): every table carries `tenant_id` and is read
through `scoped(ctx, table, …)` (`packages/core/src/context.ts:49`); anything
that changes money or contractual state goes through `runTxn`
(`packages/ledger/src/txn.ts`) with an idempotency key, a state machine and
approvals (§12); no industry noun is hard-coded in a UI string or a prompt —
every label resolves through `labelsFrom(...)(locale, pack)`
(`apps/web/app/routes/detail-kit.tsx`) and every prompt through the pack
vocabulary (§14); reserved seams are implemented against, not around (§15).

Three decisions taken up front, because everything else depends on them:

1. **`axis_policies` stays the contract head; versions live in a new child
   table.** Alternative was widening `axis_policies_no_uq`
   (`packages/db/src/schema/axis.ts:151`) to include a `version_seq`, the way
   `axis_sops_uq` (`:190`) does. Rejected: `axis_claims.policy_id`,
   `dist_commission_entries.policyId`, `core_files` subject refs and
   `orbit-tools.ts` `fetch_policy` all point at one policy id, and multiplying
   head rows would re-point every one of them.
2. **Endorsement does not move policy status.** It appends a version row and
   emits `ENDORSE`. Status is about the contract's existence; versions are about
   its terms.
3. **The tenant is an intermediary, not a risk carrier, so reserves are memo,
   not GL.** `CLAIM-RESERVE` is a non-financial (`⊘`) transaction; only claim
   funding, payment and recovery post to the ledger. A risk-carrying tenant
   needs an ADR plus one recipe row, not a redesign.

---

## A. Role design

### A.1 New permission keys

`packages/core/src/rbac.ts` — keys not present in the `PERMISSIONS` array are
ungrantable, so every key below must be added to the AXIS block (currently
lines 93–104). Convention is `module:resource:action`, all lower snake.

```ts
// policy lifecycle — one key per consequential verb, because authority differs
"axis:policies:bind",          // convert a selected quote into a contract
"axis:policies:endorse",       // append a priced version (MTA)
"axis:policies:reinstate",
"axis:policies:renew",
"axis:policies:ntu",           // not-taken-up: unwind before inception
"axis:policies:lapse",         // manual lapse; the scheduler uses actor kind "system"
"axis:policies:document",      // generate/regenerate a schedule or certificate
"axis:policies:refer",         // send to the underwriting referral desk
"axis:policies:decide_referral",

// claims
"axis:claims:register",        // FNOL intake (wider than axis:claims:create)
"axis:claims:triage",
"axis:claims:reserve",         // write a reserve movement
"axis:claims:pay",             // request a claim payment
"axis:claims:pay_approve",     // second pair of eyes on a payment
"axis:claims:recover",         // subrogation / salvage
"axis:claims:reopen",
"axis:claims:close",

// conduct & fraud
"axis:complaints:read", "axis:complaints:write", "axis:complaints:close",
"axis:siu:read", "axis:siu:write", "axis:siu:decide",

// reporting
"axis:bordereaux:read", "axis:bordereaux:generate", "axis:bordereaux:reconcile",
"axis:reports:read"            // loss runs, production, triangles, retention
```

`axis:policies:create` stays and keeps meaning "insert a policy row" (the
generic CRUD path in `apps/api/src/resources.ts:245-307`); `axis:policies:bind`
is the lifecycle verb. After M-AXIS-1 the generic create is admin-only — see
§H task 3.

### A.2 Role bundles

Extend `ROLES` (`packages/core/src/rbac.ts:287-323`). `axis.agent`,
`axis.lead`, `axis.admin` keep their current membership; four roles are new.

| Role | Adds | Does not get |
|---|---|---|
| `axis.underwriter` | `axis:policies:bind/endorse/renew/refer/decide_referral/document`, `axis:quotes:approve`, `core:approvals:read/decide`, `axis:reports:read` | `axis:claims:pay*`, `axis:policies:cancel` |
| `axis.claims_handler` | `axis:claims:register/triage/reserve/pay/recover/reopen/close`, `axis:claims:update`, `axis:documents:*` reads, `axis:policies:read`, `axis:complaints:write` | `axis:claims:pay_approve`, `axis:claims:approve`, `axis:policies:*` writes |
| `axis.claims_manager` | everything `axis.claims_handler` has plus `axis:claims:approve`, `axis:claims:pay_approve`, `axis:siu:decide`, `axis:complaints:close`, `axis:reports:read` | `axis:policies:bind` |
| `axis.broker` | `axis:policies:read`, `axis:claims:read/register`, `axis:quotes:read/create/compare`, `axis:cases:read/create`, `dist:commissions:read` — scoped by the caller's `channelId` | any approve/decide key, `core:pii:view` |

`axis.claims_handler` and `axis.claims_manager` are deliberately disjoint on
`pay` vs `pay_approve` so a handler can never be both requester and approver;
`gate()`'s dual-control check enforces distinct actor ids, the role split makes
the mistake impossible to configure away.

Broker channel scoping is not a new mechanism: `axis:policies:read` for a broker
resolves against `channelId` the same way `dist` channel reads already do. If a
broker principal has no `channelId` on its session claims, the list returns
empty rather than everything — fail closed.

### A.3 Approval policies

`packages/core/src/approvals.ts` currently declares nine AXIS policies (lines
56–66). Amend two and add six:

```ts
// AMEND — docs/19 §4.1 says CANCEL needs dual control when it produces a
// refund, and REINSTATE always does. Today both are dualControl: "never".
policy({ key: "axis.cancel", module: "axis", decide: "axis:policies:cancel",
         dualControl: "above_threshold", defaultThresholdMinor: 0 }),
//   threshold 0 + above_threshold  ==  "dual control whenever money moves back",
//   because gate() is called with amountMinor = |refundMinor| and omits the
//   amount entirely on a nil-refund cancellation.
policy({ key: "axis.reinstate", module: "axis", decide: "axis:policies:reinstate",
         dualControl: "always" }),

// NEW
policy({ key: "axis.ntu", module: "axis", decide: "axis:policies:ntu",
         dualControl: "above_threshold", defaultThresholdMinor: 0 }),
policy({ key: "axis.renew", module: "axis", decide: "axis:policies:renew",
         dualControl: "never", defaultThresholdMinor: 250_000_00 }),
policy({ key: "axis.underwriting_referral", module: "axis",
         decide: "axis:policies:decide_referral",
         dualControl: "above_threshold", defaultThresholdMinor: 500_000_00 }),
policy({ key: "axis.claim_reserve", module: "axis", decide: "axis:claims:approve",
         dualControl: "above_threshold", defaultThresholdMinor: 100_000_00 }),
policy({ key: "axis.claim_payment", module: "axis", decide: "axis:claims:pay_approve",
         dualControl: "always", neverAutoApprove: true }),
policy({ key: "axis.claim_exgratia", module: "axis", decide: "axis:claims:approve",
         dualControl: "always", neverAutoApprove: true }),
policy({ key: "axis.recovery_writeoff", module: "axis", decide: "axis:claims:approve",
         dualControl: "above_threshold", defaultThresholdMinor: 25_000_00 })
```

`axis.endorse` already exists (decide `axis:policies:update`, above_threshold
25_000_00) and is the only live gate today, at
`apps/api/src/engines/orbit-tools.ts:117-163`. Change its `decide` to
`axis:policies:endorse` in the same commit that adds the key; the subject-ref
hash convention there (`axis_endorse:${policyId}:${sha256Hex(...)}`) is kept
by the new endorsement endpoint so an agent-raised request and a desk-raised
request for the identical change-set share one approval identity.

**Amended (ADR-0065, group-e-telematics-ubi).** The shape now carries the id of
the version being superseded: `axis_endorse:${policyId}:${versionId}:${hash}`,
and the ledger idempotency key alongside it. The hash covers `{changes, reason}`
and not the price, so two endorsements naming the same factors at different
premiums shared one ledger key and the second replayed the first's settled
transaction while still superseding the version — money state with no journal
(CLAUDE.md #12). Exactly one endorsement can supersede a given version (§C.2),
so the version id is the scope. The shared-approval property is unaffected:
both raisers read the same current version.

The **ledger** key carries two fields the subject ref does not — the quote's
`premiumDeltaMinor` and `proRataDays`:
`axis.endorse:${policyId}:${versionId}:${hash}:${premiumDeltaMinor}:${proRataDays}`,
and `axis.endorse.refund:…` on the same two for the refund leg. The version stops
being the full scope when a retry re-reads it (the charge settled, the version
insert never landed) and prices differently, which is the reprice case where a
model returns another `premiumDeltaPpm` for the same factor codes. Off a fixed
version those two fields determine the whole quote — the new premium is
`current.premiumMinor + premiumDeltaMinor`, everything else derives from it and
the day count — where neither posted amount does: `share()` rounds a band of
deltas onto one `chargeMinor`, and the delta alone cannot separate a back-dated
re-issue at the same target premium. A genuine duplicate still collides. The
quote stays off the subject ref deliberately: the approval identity is the
request, not the price it computes to.

### A.4 Consequential actions and authority limits

`consequential: true` (needs approval unless the tenant's `auto_approve`
allowlist covers the type and `autoApprovable(code)` permits it —
`packages/ledger/src/types.ts`):

bind, bind_group, endorse **with a premium delta or a refund**, cancel, reinstate,
renew above threshold, NTU with refund, claim reserve above threshold, claim
approval, **every** claim payment, ex-gratia, recovery write-off, escrow release.

Never auto-approvable regardless of tenant policy: `axis.claim_payment`,
`axis.claim_exgratia`, `axis.escrow_release`, `axis.claim_settlement`. These
carry `payout: true` or `clientMoney: true` in `TXN_TYPES`, which already makes
`runTxn` throw `conflict(\`${def.code} may not be auto-approved (docs/19 §7)\`)`.

Not consequential: FNOL registration, triage, lapse by scheduler, expiry,
document regeneration, bordereau generation, reserve movements at or below
threshold, SIU referral creation.

**Authority limits** are tenant data, not code. One `axis_ops_policies` row
(`packages/db/src/schema/axis.ts:210-224`), `kind: "authority"`,
`key: "axis.authority"`, `valueJson`:

```jsonc
{
  "underwriting": [
    { "role": "axis.underwriter",  "productLine": "motor",  "maxPremiumMinor": 5000000,
      "maxSumInsuredMinor": 50000000, "referOn": ["prior_claims_gt_2", "driver_age_lt_23"] },
    { "role": "axis.lead",         "productLine": "*",      "maxPremiumMinor": 25000000 }
  ],
  "claims": [
    { "role": "axis.claims_handler",  "maxReserveMinor": 10000000, "maxPaymentMinor": 5000000 },
    { "role": "axis.claims_manager",  "maxReserveMinor": 100000000, "maxPaymentMinor": 50000000 }
  ]
}
```

Breaching a limit does not 403 — it creates a referral (§B, §D.6) and calls
`gate()` with the amount, so the approval queue is the escalation path. Absence
of the row means no delegated authority: everything above zero refers. Fail
closed, and a tenant that wants speed writes the row.

---

## B. State machines

New file `packages/core/src/lifecycle.ts` — core, not axis-api, because both the
API routes and the schedulers in `apps/agents` enforce it. Shape mirrors
`packages/ledger/src/types.ts:TRANSITIONS` + `canTransition` exactly, so there is
one idiom for "legal hop" in the codebase.

### B.1 Policy

```ts
export const POLICY_STATES = [
  "draft",     // priced, not yet bound
  "bound",     // contract exists, inception in the future
  "active",    // on risk
  "lapsed",    // non-payment; reinstatable inside the grace window
  "cancelled", // terminated mid-term
  "expired",   // ran to term end without renewal
  "renewed",   // ran to term end and a successor term exists
  "ntu"        // not taken up: unwound before it ever went on risk
] as const;
export type PolicyState = (typeof POLICY_STATES)[number];

export const POLICY_TRANSITIONS: Record<PolicyState, readonly PolicyState[]> = {
  draft:     ["bound", "ntu"],
  bound:     ["active", "ntu", "cancelled"],
  active:    ["lapsed", "cancelled", "expired", "renewed"],
  lapsed:    ["active", "cancelled", "expired"],
  cancelled: [],
  expired:   ["renewed"],       // late renewal inside the grace window
  renewed:   [],
  ntu:       []
};

export function canPolicyTransition(from: PolicyState, to: PolicyState): boolean {
  return POLICY_TRANSITIONS[from].includes(to);
}
```

Endorsement is absent on purpose: it is a version append against a policy in
`bound` or `active`, and the version has its own tiny machine
(`pending → effective → superseded`, plus `pending → voided`).

Transition table — every row is one `runTxn` call, and the event is the
`RunOptions.event` passed to it, so the emit and the ledger write share a
transaction:

| From → To | Trigger | Txn type | Financial | Approval policy | Event emitted |
|---|---|---|---|---|---|
| draft → bound | operator binds a selected quote | `BIND` | ✓ | `axis.bind` | `axis.policy.issued` |
| draft → bound (group) | group scheme | `BIND-GROUP` | ✓ | `axis.bind_group` | `axis.policy.issued` |
| bound → active | inception date reached (scheduler) | `INCEPT` | ⊘ | — | `axis.policy.incepted` |
| *(no move)* | endorsement, premium delta ≥ 0 | `ENDORSE` | ✓ | `axis.endorse` | `axis.policy.endorsed` |
| *(no move)* | endorsement, premium delta < 0 | `ENDORSE` + child `REFUND-ISSUE` | ✓ | `axis.endorse` (dual on refund) | `axis.policy.endorsed` |
| bound/active → ntu | NTU inside cooling-off | `NTU` ⊘ + children `REFUND-ISSUE`, `CMSN-CLAWBACK` | ⊘ (children ✓) | `axis.ntu` | `axis.policy.ntu` |
| active/lapsed → cancelled | cancellation | `CANCEL` + child `REFUND-ISSUE` when pro-rata refund > 0 | ✓ | `axis.cancel` | `axis.policy.cancelled` |
| active → lapsed | grace expiry, unpaid instalment (scheduler) | `LAPSE` | ⊘ | — | `axis.policy.lapsed` **and** `orbit.renewal.lost` |
| lapsed → active | reinstatement | `REINSTATE` | ✓ | `axis.reinstate` | `axis.policy.reinstated` |
| active → expired | term end, no successor (scheduler) | `EXPIRE` | ⊘ | — | `axis.policy.expired` |
| active/expired → renewed | successor term binds | `RENEW` on the **successor** row | ✓ | `axis.renew` | `axis.policy.renewed` **and** `orbit.renewal.accepted` |

`INCEPT` and `EXPIRE` are new ⊘ codes in `TXN_TYPES`; `NTU` is new ⊘. Reason for
making them transactions at all rather than plain `UPDATE`s: `runTxn` is the only
writer that produces a reversible, idempotent, audited state hop, and a
mis-fired scheduler must be reversible.

`orbit.renewal.lost` / `orbit.renewal.accepted` are the events docs/19 §4.1
already names; AXIS emits both its own `axis.*` and the ORBIT one, because
`orbit_renewals.state` (`packages/db/src/schema/orbit.ts:57-82`) is driven by
them and nothing else may write it cross-module (`CLAUDE.md` §6).

### B.2 Claim

```ts
export const CLAIM_STATES = [
  "reported",      // FNOL captured, coverage not yet confirmed  (existing default)
  "triage",        // coverage checked, severity + fraud scored
  "assessing",
  "awaiting_docs",
  "approved",      // liability + quantum agreed
  "rejected",
  "settling",      // payment authorized, money in flight
  "settled",       // all indemnity paid
  "recovering",    // subrogation/salvage open after settlement
  "closed",
  "reopened",
  "withdrawn"
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_TRANSITIONS: Record<ClaimState, readonly ClaimState[]> = {
  reported:      ["triage", "withdrawn"],
  triage:        ["assessing", "rejected", "withdrawn"],
  assessing:     ["awaiting_docs", "approved", "rejected", "withdrawn"],
  awaiting_docs: ["assessing", "withdrawn"],
  approved:      ["settling"],
  settling:      ["settled", "approved"],   // back to approved if a payment fails
  settled:       ["recovering", "closed", "reopened"],
  recovering:    ["closed", "reopened"],
  rejected:      ["reopened", "closed"],
  closed:        ["reopened"],
  reopened:      ["assessing"],
  withdrawn:     []
};

export function canClaimTransition(from: ClaimState, to: ClaimState): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}
```

`reported` is retained as the initial state so the existing
`axis_claims.status` default (`packages/db/src/schema/axis.ts:241`) and seeded
rows stay legal. `withdrawn` remains terminal.

| From → To | Trigger | Txn type | Financial | Approval | Event |
|---|---|---|---|---|---|
| — → reported | FNOL intake | `FNOL-REGISTER` | ⊘ | — | `axis.claim.registered` **and** `orbit.fnol.registered` |
| reported → triage | coverage-in-force check passes | `CLAIM-SYNC` | ⊘ | — | `axis.claim.triaged` |
| reported → triage, cover fails | same, `coverageState != "in_force"` | `CLAIM-SYNC` | ⊘ | — | `axis.claim.coverage_failed` |
| any open state | reserve movement | `CLAIM-RESERVE` | ⊘ | `axis.claim_reserve` above threshold | `axis.claim.reserved` |
| assessing → approved | liability + quantum agreed | `CLAIM-APPROVE` | ⊘ | `axis.claim_settlement` (dual, always) | `axis.claim.approved` |
| assessing/triage → rejected | declinature | `CLAIM-DECLINE` | ⊘ | `axis.claim_settlement` | `axis.claim.rejected` |
| approved → settling | payment requested | `CLAIM-PAY` | ✓ | `axis.claim_payment` (dual, never auto) | `axis.claim.payment_requested` |
| settling → settled | payment confirmed | (same txn reaches `settled`) | ✓ | — | `axis.claim.paid` |
| — (any) | insurer funds the claim account | `CLAIM-FUND` | ✓ | — (receipt) | `axis.claim.funded` |
| settled → recovering | subrogation opened | `RECOVERY-OPEN` | ⊘ | — | `axis.claim.recovery_opened` |
| recovering | money recovered | `RECOVERY-RECEIPT` | ✓ | — (receipt) | `axis.claim.recovered` |
| recovering → closed | write-off | `RECOVERY-WRITEOFF` | ✓ | `axis.recovery_writeoff` | `axis.claim.recovery_closed` |
| settled/recovering/rejected → closed | desk closes | `CLAIM-CLOSE` | ⊘ | — | `axis.claim.closed` |
| closed/settled → reopened | new information | `CLAIM-REOPEN` | ⊘ | `axis.claim_settlement` | `axis.claim.reopened` |

### B.3 Ledger catalogue additions

`packages/ledger/src/types.ts` — new rows in the same tuple shape
`[code, financial, approvalPolicyKey]`, with `payout`/`clientMoney` where
applicable. `docs/19 §4` has no claims vocabulary at all today; §4.1 gains a
"claims lifecycle" block mirroring this:

```ts
["INCEPT",            false, null],
["EXPIRE",            false, null],
["NTU",               false, "axis.ntu"],
["CLAIM-RESERVE",     false, "axis.claim_reserve"],
["CLAIM-APPROVE",     false, "axis.claim_settlement"],
["CLAIM-DECLINE",     false, "axis.claim_settlement"],
["CLAIM-CLOSE",       false, null],
["CLAIM-REOPEN",      false, "axis.claim_settlement"],
["CLAIM-FUND",        true,  null],              // clientMoney: true
["CLAIM-PAY",         true,  "axis.claim_payment"], // payout + clientMoney: true
["RECOVERY-OPEN",     false, null],
["RECOVERY-RECEIPT",  true,  null],              // clientMoney: true
["RECOVERY-REMIT",    true,  null],              // clientMoney: true
["RECOVERY-WRITEOFF", true,  "axis.recovery_writeoff"],
["RECOVERY-FEE",      true,  null]
```

`RENEW` already maps to approval `axis.bind`; change it to `axis.renew` so the
renewal threshold is tunable independently. That is a catalogue edit, not an
engine edit.

### B.4 Recipes

`packages/ledger/src/recipes.ts` — a new transaction type is a row here, never a
branch in the engine (the file's own comment). Chart of accounts gains four
codes in `docs/19 §5.1`:

| Code | Name | Type |
|---|---|---|
| 1150 | Recovery Receivable | asset |
| 1170 | Claim Float — insurer funded | asset (client money sub-ledger) |
| 4090 | Recovery & Service Fees | income |
| 5400 | Recovery Written Off | expense |

Builders (pure `(args) => PostingLine[]`, `lines()` drops zero legs, exactly like
the existing fifteen):

```ts
/** Insurer transfers claim funds to us before we pay the claimant. */
export function claimFunding(a: ClientMoneyArgs): PostingLine[] {
  return lines(
    line("1010", "debit",  a.amountMinor, "claim float received", a.dims),
    line("2010", "credit", a.amountMinor, "client money liability — claims", a.dims)
  );
}

/** Paying the claimant/repairer out of client money we hold for the insurer. */
export function claimPayment(a: ClaimPaymentArgs): PostingLine[] {
  return lines(
    line("2010", "debit",  a.amountMinor, "claim paid to payee", a.dims),
    line("1010", "credit", a.amountMinor, "client money out", a.dims)
  );
}

/** Third-party money recovered; owed onward to the insurer net of our fee. */
export function recoveryReceipt(a: RecoveryArgs): PostingLine[] {
  return lines(
    line("1010", "debit",  a.amountMinor,               "recovery received", a.dims),
    line("4090", "credit", a.feeMinor ?? 0,             "recovery fee", a.dims),
    line("2010", "credit", a.amountMinor - (a.feeMinor ?? 0), "owed to insurer", a.dims)
  );
}

export function recoveryWriteOff(a: RecoveryArgs): PostingLine[] {
  return lines(
    line("5400", "debit",  a.amountMinor, "recovery written off", a.dims),
    line("1150", "credit", a.amountMinor, "recovery receivable cleared", a.dims)
  );
}
```

Registry rows: `CLAIM-FUND: spec(ClientMoneyArgs, claimFunding)`,
`CLAIM-PAY: spec(ClaimPaymentArgs, claimPayment)`,
`RECOVERY-RECEIPT: spec(RecoveryArgs, recoveryReceipt)`,
`RECOVERY-REMIT: spec(ClientMoneyArgs, premiumRemittance)` (same shape, different
memo — reuse, do not clone), `RECOVERY-WRITEOFF: spec(RecoveryArgs,
recoveryWriteOff)`, `RECOVERY-FEE: spec(CommissionArgs, commissionAccrual)` with
`defaults: { incomeAccount: "4090", receivableAccount: "1150" }`,
`NTU: spec(CommissionArgs, commissionClawback)` when commission was accrued —
otherwise NTU carries no recipe because it is ⊘.

The `1010 ≥ 2010` invariant in docs/19 §5.1 is unaffected: every claim leg moves
both sides together. Property test obligation eleven is added to docs/19 §11:
*"claim float never goes negative — Σ CLAIM-PAY for a policy ≤ Σ CLAIM-FUND for
that policy plus opening float"*.

---

## C. Data model

Drizzle SQLite dialect (`packages/db/src/schema/axis.ts`), must run on D1 and
libSQL alike. Forward-only migrations; `pnpm db:generate` names the files, the
numbers below are what matter (latest applied is
`packages/db/migrations/0015_wealthy_tigra.sql`).

### C.1 `axis_policies` — head row, amended

```ts
// added to the existing definition at packages/db/src/schema/axis.ts:124-153
currentVersionId: text("current_version_id"),         // -> axis_policy_versions.id
versionSeq: integer("version_seq").notNull().default(1),
taxMinor: integer("tax_minor").notNull().default(0),  // F25: dist_quote_responses
feesMinor: integer("fees_minor").notNull().default(0),//      already carries both
grossMinor: integer("gross_minor").notNull().default(0), // premium+tax+fees, denormalized
renewedFromPolicyId: text("renewed_from_policy_id"),  // prior term, same risk
renewalSeq: integer("renewal_seq").notNull().default(0), // 0 = new business
inceptedAt: integer("incepted_at"),
lapsedAt: integer("lapsed_at"),
cancelledAt: integer("cancelled_at"),
cancelReasonCode: text("cancel_reason_code"),
cancelEffectiveAt: integer("cancel_effective_at"),    // may differ from cancelledAt
statusReason: text("status_reason"),
lastTxnId: text("last_txn_id"),                       // -> ledger_txns.id
// status comment becomes: draft|bound|active|lapsed|cancelled|expired|renewed|ntu
```

New index: `index("axis_policies_renewal_idx").on(t.tenantId, t.renewedFromPolicyId)`.
`axis_policies_no_uq` is untouched — one policy number, one head row, which is
the whole point of decision 1.

`premiumMinor` on the head keeps meaning **current annualized net premium** and
is written only from the head version. `paymentPlanJson` loses its `// H9
reserved` comment and gains a shape in §C.7.

### C.2 `axis_policy_versions` — new

The crux. Endorsement history stops being "every policy sharing a
`customerId`" (`apps/web/app/routes/policy-detail.tsx:229-236`) and becomes a
real child list.

```ts
export const policyVersions = sqliteTable(
  "axis_policy_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),        // -> axis_policies.id
    versionSeq: integer("version_seq").notNull(), // 1 = as issued
    endorsementNo: text("endorsement_no"),        // insurer's ref, null on seq 1
    reason: text("reason").notNull(),             // issue|endorsement|cancellation|reinstatement|renewal_rollover|correction
    reasonCode: text("reason_code"),              // tenant taxonomy, e.g. mta.vehicle_change
    effectiveFrom: integer("effective_from").notNull(),
    effectiveTo: integer("effective_to").notNull(),
    premiumMinor: integer("premium_minor").notNull(),
    taxMinor: integer("tax_minor").notNull().default(0),
    feesMinor: integer("fees_minor").notNull().default(0),
    commissionMinor: integer("commission_minor").notNull().default(0),
    currency: text("currency").notNull(),
    premiumDeltaMinor: integer("premium_delta_minor").notNull().default(0), // signed vs prior
    proRataDays: integer("pro_rata_days"),
    termsJson: text("terms_json").notNull(),   // full priced terms snapshot: cover, limits, excess, insured items
    ratingJson: text("rating_json"),           // Priced from apps/api/src/engines/rating.ts:105
    quoteResponseId: text("quote_response_id"),// -> dist_quote_responses.id  (F13 seam)
    txnId: text("txn_id"),                     // -> ledger_txns.id that authorized it
    approvalId: text("approval_id"),           // -> core_approvals.id
    documentFileId: text("document_file_id"),  // -> core_files.id, THIS version's schedule
    deliveredAt: integer("delivered_at"),
    deliveryRef: text("delivery_ref"),         // orbit message id
    state: text("state").notNull().default("pending"), // pending|effective|superseded|voided
    issuedBy: text("issued_by").notNull(),
    issuedAt: integer("issued_at").notNull(),
    supersededAt: integer("superseded_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_policy_versions_seq_uq").on(t.tenantId, t.policyId, t.versionSeq),
    index("axis_policy_versions_policy_idx").on(t.tenantId, t.policyId, t.effectiveFrom),
    index("axis_policy_versions_txn_idx").on(t.tenantId, t.txnId)
  ]
);
```

Invariants, property-tested (§H task 2):
- exactly one version per policy in state `effective` at any instant;
- version intervals `[effectiveFrom, effectiveTo)` are contiguous and
  non-overlapping across all non-`voided` versions of a policy;
- `versionSeq` is dense from 1;
- `policies.currentVersionId` points at the `effective` version and
  `policies.versionSeq` equals its `versionSeq`;
- `Σ premiumDeltaMinor` over non-voided versions `= head.premiumMinor − v1.premiumMinor`.

Renewal is **not** a version: it is a new head row with
`renewedFromPolicyId` set and `renewalSeq = prior.renewalSeq + 1`, plus its own
`versionSeq = 1` version. A renewal is a new contract; an endorsement is the
same contract repriced. `reason: "renewal_rollover"` exists for the case where an
insurer renews by endorsement rather than by new number — then the head is
reused and `renewalSeq` still increments.

### C.3 `axis_claims` — amended

```ts
// added to packages/db/src/schema/axis.ts:227-252
policyVersionId: text("policy_version_id"),   // F24: the version in force at incidentAt
coverageState: text("coverage_state").notNull().default("unknown"),
  // in_force|not_yet_incepted|lapsed_at_loss|cancelled_at_loss|out_of_cover|unknown
coverageCheckedAt: integer("coverage_checked_at"),
coverageJson: text("coverage_json"),          // the limits/excess applied, snapshotted
perilCode: text("peril_code"),
causeCode: text("cause_code"),
catCode: text("cat_code"),                    // catastrophe event grouping
reserveMinor: integer("reserve_minor").notNull().default(0),    // denormalized head of history
paidMinor: integer("paid_minor").notNull().default(0),
recoveredMinor: integer("recovered_minor").notNull().default(0),
excessMinor: integer("excess_minor").notNull().default(0),
handlerRef: text("handler_ref"),              // user:<id>; assessorRef stays for the external assessor
slaDueAt: integer("sla_due_at"),
fraudScore: integer("fraud_score"),           // 0-100, from the SIU model
siuState: text("siu_state"),                  // null|referred|clearing|substantiated
complexity: text("complexity").notNull().default("standard"), // fast_track|standard|complex|litigated
reopenedAt: integer("reopened_at"),
closedAt: integer("closed_at"),
lastTxnId: text("last_txn_id")
```

The two existing money fields keep clean, distinct meanings instead of being
deleted (forward-only, and both are already written):
`amountMinor` = amount notified by the claimant;
`settledMinor` = agreed settlement once approved.
`incurredMinor` is never stored — it is `paidMinor + reserveMinor − recoveredMinor`,
computed in one place, `packages/core/src/claims.ts:incurred(claim)`.

New index: `index("axis_claims_policy_idx").on(t.tenantId, t.policyId, t.reportedAt)`
(claims-by-policy is the loss-run query and today has no index at all).

### C.4 `axis_claim_reserves` — new

F23: reserve becomes a history, not one mutable integer.

```ts
export const claimReserves = sqliteTable(
  "axis_claim_reserves",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    claimId: text("claim_id").notNull(),
    seq: integer("seq").notNull(),
    head: text("head").notNull().default("indemnity"), // indemnity|expense|recovery
    amountMinor: integer("amount_minor").notNull(),        // reserve AFTER this movement
    previousMinor: integer("previous_minor").notNull().default(0),
    deltaMinor: integer("delta_minor").notNull(),          // signed
    currency: text("currency").notNull(),
    basis: text("basis").notNull(), // ai_recommended|assessor|desk_estimate|insurer_advised|formula|closure
    rationale: text("rationale"),
    evidenceJson: text("evidence_json"),  // doc ids / comparable claims the estimate cites
    confidence: integer("confidence"),    // 0-100 when basis = ai_recommended
    aiAuditId: text("ai_audit_id"),       // -> ai_audit_log.id
    approvalId: text("approval_id"),
    txnId: text("txn_id"),
    setBy: text("set_by").notNull(),
    setAt: integer("set_at").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_claim_reserves_seq_uq").on(t.tenantId, t.claimId, t.head, t.seq),
    index("axis_claim_reserves_claim_idx").on(t.tenantId, t.claimId, t.setAt)
  ]
);
```

Append-only: no `UPDATE`, no `DELETE`. `axis_claims.reserveMinor` is the sum of
the latest `amountMinor` per head and is written in the same statement batch —
denormalized because every list screen and the triangle report needs it, and a
per-row correlated subquery on D1 is not worth it.

Reserve at any past date (needed for triangles, §E.4) is
`the latest row per head with setAt <= asOf`. That is the whole reason the
history exists.

### C.5 `axis_claim_payments` — new

```ts
export const claimPayments = sqliteTable(
  "axis_claim_payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    claimId: text("claim_id").notNull(),
    kind: text("kind").notNull(),      // indemnity|expense|interim|final|ex_gratia|excess_refund
    payeeKind: text("payee_kind").notNull(), // claimant|repairer|provider|third_party|insurer
    payeeRef: text("payee_ref"),
    payeeSealed: text("payee_sealed"), // bank details via sealFields — never plaintext
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull().default("eft"), // eft|cheque|card|insurer_direct
    txnId: text("txn_id").notNull(),   // -> ledger_txns.id; the money is the txn, this row is the record
    approvalId: text("approval_id"),
    state: text("state").notNull().default("requested"), // requested|approved|paid|failed|reversed
    failureCode: text("failure_code"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: integer("requested_at").notNull(),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_claim_payments_txn_uq").on(t.tenantId, t.txnId),
    index("axis_claim_payments_claim_idx").on(t.tenantId, t.claimId, t.state)
  ]
);
```

`axis_claim_payments_txn_uq` is what makes double payment structurally
impossible: one ledger transaction, one payment record.

### C.6 `axis_claim_recoveries` — new

```ts
export const claimRecoveries = sqliteTable(
  "axis_claim_recoveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    claimId: text("claim_id").notNull(),
    kind: text("kind").notNull(),   // subrogation|salvage|excess|reinsurance|third_party
    counterpartyRef: text("counterparty_ref"),
    expectedMinor: integer("expected_minor").notNull().default(0),
    recoveredMinor: integer("recovered_minor").notNull().default(0),
    feeMinor: integer("fee_minor").notNull().default(0),
    currency: text("currency").notNull(),
    state: text("state").notNull().default("identified"), // identified|pursuing|agreed|recovered|written_off|abandoned
    nextActionAt: integer("next_action_at"),
    prospects: integer("prospects"),  // 0-100, AI-scored likelihood
    txnId: text("txn_id"),
    approvalId: text("approval_id"),  // write-off approval
    openedBy: text("opened_by").notNull(),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("axis_claim_recoveries_idx").on(t.tenantId, t.state, t.nextActionAt)]
);
```

### C.7 `paymentPlanJson` shape (F26 partial)

No new table — a plan is a property of the head, and instalment collection is
already `PREM-INSTALMENT` in the txn catalogue.

```jsonc
{
  "frequency": "annual|monthly|quarterly",
  "instalments": [
    { "seq": 1, "dueAt": 1767225600, "grossMinor": 120000, "state": "paid",
      "txnId": "txn_…", "paidAt": 1767229200 },
    { "seq": 2, "dueAt": 1769904000, "grossMinor": 120000, "state": "due" }
  ],
  "graceDays": 15,
  "lapseOnMissed": true
}
```

The lapse scheduler reads `graceDays` and the first `due` instalment past
`dueAt + graceDays` to fire `LAPSE`. Instalment states: `due|paid|failed|waived`.

### C.8 `axis_bordereaux` / `axis_bordereau_lines` — new (P2)

Zero hits in code or docs today. Both directions in one pair of tables because a
bordereau is the same document read in two directions.

```ts
export const bordereaux = sqliteTable(
  "axis_bordereaux",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    direction: text("direction").notNull(),        // inbound|outbound
    counterpartyKind: text("counterparty_kind").notNull(), // provider|channel|partner
    counterpartyId: text("counterparty_id").notNull(),
    kind: text("kind").notNull(),                  // premium|claims|combined
    period: text("period").notNull(),              // YYYY-MM
    currency: text("currency").notNull(),
    lineCount: integer("line_count").notNull().default(0),
    grossPremiumMinor: integer("gross_premium_minor").notNull().default(0),
    commissionMinor: integer("commission_minor").notNull().default(0),
    claimsPaidMinor: integer("claims_paid_minor").notNull().default(0),
    reserveMinor: integer("reserve_minor").notNull().default(0),
    varianceMinor: integer("variance_minor").notNull().default(0),
    state: text("state").notNull().default("draft"), // draft|generated|sent|acknowledged|matched|variance|closed
    fileId: text("file_id"),        // what we produced (outbound) — core_files.id
    sourceFileId: text("source_file_id"), // what they sent (inbound)
    escrowBatchId: text("escrow_batch_id"), // ties premium bordereaux to axis_escrow_batches
    generatedBy: text("generated_by").notNull(),
    generatedAt: integer("generated_at").notNull(),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_bordereaux_uq")
      .on(t.tenantId, t.direction, t.counterpartyId, t.kind, t.period),
    index("axis_bordereaux_state_idx").on(t.tenantId, t.state, t.period)
  ]
);

export const bordereauLines = sqliteTable(
  "axis_bordereau_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bordereauId: text("bordereau_id").notNull(),
    lineNo: integer("line_no").notNull(),
    policyId: text("policy_id"),
    policyVersionId: text("policy_version_id"),
    claimId: text("claim_id"),
    externalRef: text("external_ref"),   // their policy/claim number
    riskRef: text("risk_ref"),           // VIN, plate, member no — pack-neutral
    effectiveFrom: integer("effective_from"),
    effectiveTo: integer("effective_to"),
    grossPremiumMinor: integer("gross_premium_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    commissionMinor: integer("commission_minor").notNull().default(0),
    claimsPaidMinor: integer("claims_paid_minor").notNull().default(0),
    reserveMinor: integer("reserve_minor").notNull().default(0),
    currency: text("currency").notNull(),
    matchState: text("match_state").notNull().default("unmatched"),
      // unmatched|matched|variance|missing_ours|missing_theirs
    varianceMinor: integer("variance_minor").notNull().default(0),
    rawJson: text("raw_json"),           // the inbound row as received, verbatim
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_bordereau_lines_no_uq").on(t.tenantId, t.bordereauId, t.lineNo),
    index("axis_bordereau_lines_match_idx").on(t.tenantId, t.bordereauId, t.matchState),
    index("axis_bordereau_lines_policy_idx").on(t.tenantId, t.policyId)
  ]
);
```

### C.9 `axis_complaints` / `axis_siu_referrals` / `axis_referrals` — new

```ts
export const complaints = sqliteTable(
  "axis_complaints",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ref: text("ref").notNull(),
    customerId: text("customer_id"),
    policyId: text("policy_id"),
    claimId: text("claim_id"),
    caseId: text("case_id"),
    channel: text("channel").notNull(),      // web|phone|email|whatsapp|regulator|social
    categoryCode: text("category_code").notNull(), // tenant taxonomy
    summarySealed: text("summary_sealed"),   // sealFields — may contain PII
    receivedAt: integer("received_at").notNull(),
    acknowledgedAt: integer("acknowledged_at"),
    dueAt: integer("due_at").notNull(),      // regulatory clock
    resolvedAt: integer("resolved_at"),
    state: text("state").notNull().default("received"),
      // received|investigating|awaiting_customer|resolved|escalated|closed
    outcome: text("outcome"),                // upheld|partly_upheld|not_upheld|withdrawn
    rootCauseCode: text("root_cause_code"),
    redressMinor: integer("redress_minor").notNull().default(0),
    currency: text("currency"),
    regulatorRef: text("regulator_ref"),
    ownerRef: text("owner_ref"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_complaints_ref_uq").on(t.tenantId, t.ref),
    index("axis_complaints_due_idx").on(t.tenantId, t.state, t.dueAt)
  ]
);

export const siuReferrals = sqliteTable(
  "axis_siu_referrals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    claimId: text("claim_id").notNull(),
    policyId: text("policy_id"),
    score: integer("score").notNull(),        // 0-100
    reasonsJson: text("reasons_json").notNull(), // [{ indicator, weight, evidenceRef }]
    aiAuditId: text("ai_audit_id"),
    source: text("source").notNull().default("model"), // model|handler|insurer|tip
    state: text("state").notNull().default("open"),
      // open|investigating|substantiated|unsubstantiated|closed
    assignedTo: text("assigned_to"),
    outcome: text("outcome"),
    savedMinor: integer("saved_minor").notNull().default(0), // leakage prevented
    currency: text("currency"),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    uniqueIndex("axis_siu_claim_uq").on(t.tenantId, t.claimId),
    index("axis_siu_state_idx").on(t.tenantId, t.state, t.score)
  ]
);

/** Underwriting referrals: a risk outside delegated authority. */
export const referrals = sqliteTable(
  "axis_referrals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id"),
    policyId: text("policy_id"),
    quoteResponseId: text("quote_response_id"),
    kind: text("kind").notNull(),   // authority_limit|eligibility|sanctions|manual
    triggerJson: text("trigger_json").notNull(), // which rule fired, with values
    valueMinor: integer("value_minor"),
    currency: text("currency"),
    state: text("state").notNull().default("open"), // open|accepted|declined|counter_offered|expired
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    counterTermsJson: text("counter_terms_json"),
    approvalId: text("approval_id"),
    slaDueAt: integer("sla_due_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("axis_referrals_state_idx").on(t.tenantId, t.state, t.slaDueAt)]
);
```

### C.10 F13 — `axis_quotes` vs `dist_quote_responses`

Today `axis_quotes` is written in exactly one place,
`packages/core/src/seed.ts:791`, while the working panel fan-out writes
`dist_quote_responses` (`packages/db/src/schema/dist.ts:159-194`). Two tables,
one concept.

**Resolution: `dist_quote_responses` is the single source of quote truth;
`axis_quotes` is retired as a write target and kept only as the manual-quote
capture path.** Concretely:

- `axis_quotes.source` values `api` and `ai_extract` are retired. The bind path
  reads `dist_quote_responses` by `quoteResponseId` and never touches
  `axis_quotes`.
- A quote keyed manually (broker rings an underwriter) is written **into
  `dist_quote_responses`** with `state: "quoted"` and a synthetic
  `requestId` created for the case. That keeps the comparison screen, the
  ranking in `rankOutcomes` (`apps/api/src/engines/rating.ts:349`) and the bind
  path on one table.
- `axis_quotes` therefore has no writer left. It is **not** dropped in this pass
  (forward-only; the seed and any tenant data reference it). It is marked
  `@deprecated` in the schema with the removal migration deferred to the pass
  that also drops the seed row. `apps/api/src/resources.ts` demotes `quotes` to
  read-only.
- `packages/core/src/seed.ts:770-810` changes to write the winning
  `dist_quote_responses` row's id into `axis_policy_versions.quoteResponseId`
  instead of an `axis_quotes` row.

Not papering over it: the seam that already exists — `axis_quotes.responseId`
(`packages/db/src/schema/axis.ts:49`) — was the author admitting the same thing.
The design picks the table the fan-out already writes and deletes the fork.

### C.11 Migrations

| # | Contents |
|---|---|
| `0016` | `axis_policy_versions`; `axis_policies` new columns; `axis_policies_renewal_idx`; backfill one `versionSeq = 1, state = "effective", reason = "issue"` version per existing policy from the head's own values, and set `current_version_id` |
| `0017` | `axis_claims` new columns; `axis_claim_reserves`, `axis_claim_payments`, `axis_claim_recoveries`; `axis_claims_policy_idx`; backfill a `seq = 1` reserve row per claim whose `amount_minor IS NOT NULL` (`basis: "desk_estimate"`, `setBy: "system:migration"`) and set `reserve_minor` |
| `0018` | `axis_bordereaux`, `axis_bordereau_lines` |
| `0019` | `axis_referrals`, `axis_complaints`, `axis_siu_referrals` |

The `0016` and `0017` backfills are the reason those two migrations exist rather
than one: a failed backfill on a live tenant should not strand claims tables.

---

## D. CRUD surfaces

House patterns every screen below follows, no exceptions: `labelsFrom(LABELS)`
returning `(locale, pack)` from `apps/web/app/routes/detail-kit.tsx` (the
locale-only `labelsIn` used by `axis-board.tsx` is a bug — see §D.9); `safe()`
around each optional panel so a 403 degrades to null instead of a 500;
`GuardrailNotice` + `<Gate problem={phrase(result.problem, l)} />` for refusals;
en + ar label objects; logical CSS properties; idempotency key per action intent
(`${key}:${intent}`, the convention at
`apps/web/app/routes/claim-detail.tsx`).

Routes are registered in `apps/web/app/routes.ts` in the static-record block
(lines 79–88), which ranks above the generic `:module/:resource/:id`.

### D.1 FNOL intake — `axis/claims/new`

`route("axis/claims/new", "routes/fnol-intake.tsx")`

Loader (`axis:claims:register`): `{ policies, recentClaims, perils, packLabels }` —
policies are the caller's searchable in-force set
(`GET /v1/axis/policies?state=active,bound&q=`); `perils` from the domain pack.
Deliberately **no** customer PII prefetch: FNOL is often taken from a third
party.

Action intents:
- `check-cover` → `POST /v1/axis/claims/coverage-check` `{ policyId, incidentAt }`
  → `{ coverageState, policyVersionId, limits, excessMinor, warnings[] }`.
  Runs before anything is written. F24 closed.
- `register` → `POST /v1/axis/claims` (the lifecycle route, §D.10) with
  `{ policyId, incidentAt, perilCode, causeCode, description, notifiedMinor,
     contact, channel }`. Emits `FNOL-REGISTER`.
- `attach` → existing document upload.

Empty state: "No cover found for that date" is **not** a dead end — it offers
"Register anyway, flag for review", which writes the claim with
`coverageState: "out_of_cover"` and `status: "reported"`, because refusing to
record a notification is a conduct failure.

Out-of-cover registration renders an amber `GuardrailNotice`, never a modal
(`CLAUDE.md` §11).

### D.2 Claims desk — `axis/claims/desk`

`route("axis/claims/desk", "routes/claims-desk.tsx")`

Queue for handlers. Loader (`axis:claims:read`): one list call plus counts per
lane, mirroring the board's loader shape, lanes = `CLAIM_STATES` minus terminal.
Row shows: claim ref, holder, peril, incurred, reserve, days open, SLA flag,
fraud score chip, SIU chip, handler.

Sort: same `byValue` scorer as the board (§D.9), with incurred as value.

Action intents: `assign` (PATCH `handlerRef`), `transition`
(`POST /v1/axis/claims/:id/transition`), `bulk-chase` (queues the Chaser agent
for the selected rows — proposes drafts, sends nothing).

Empty state: "No open notifications" plus a link to FNOL intake.

### D.3 Claim detail — amend `apps/web/app/routes/claim-detail.tsx`

Three changes, all forced by §B/§C:

1. The reserve control at `:450-461` (`name="amountMinor"` overwriting in place)
   becomes an **append**: `intent="reserve"` posting
   `{ head, amountMinor, basis, rationale }` to
   `POST /v1/axis/claims/:id/reserves`. A reserve history table renders below it
   (seq, date, head, from → to, basis, who, approval link).
2. `intent="settle"` at `:279-282` no longer flips `status` to `settled`. It
   becomes `intent="approve"` (→ `approved`, gate `axis.claim_settlement`) and a
   separate `intent="request-payment"` posting to
   `POST /v1/axis/claims/:id/payments`, which is what moves `settling → settled`
   via `CLAIM-PAY`. Money leaves through the ledger, never through a PATCH.
3. New panels: payments, recoveries, coverage snapshot (with the
   `policyVersionId` in force at incident, linked), SIU chip.

`ASSESSMENTS` (currently `["assessing","approved","rejected"]`) is replaced by
`CLAIM_TRANSITIONS[claim.status]` so the UI cannot offer an illegal hop.

### D.4 Endorsement wizard — `axis/policies/:id/endorse`

`route("axis/policies/:id/endorse", "routes/policy-endorse.tsx")`

Replaces the "POST a brand-new policy" action at
`apps/web/app/routes/policy-detail.tsx:257-305`.

Loader (`axis:policies:endorse`): `{ policy, currentVersion, allowedChanges,
ratePreview: null, authority }`. `allowedChanges` comes from the product's
`termsSchema`, so the wizard is pack-neutral — it renders the fields the product
declares, never a hard-coded "vehicle" form.

Steps: (1) effective date, (2) what changes, (3) **price preview** —
`POST /v1/axis/policies/:id/endorse/preview` returns
`{ premiumDeltaMinor, taxDeltaMinor, proRataDays, refundMinor, needsApproval,
   needsReferral }` and writes nothing, (4) confirm.

Confirm → `POST /v1/axis/policies/:id/endorse` (idempotency key = the
`sha256Hex` of the change-set, matching `orbit-tools.ts:117-163`, so an agent
request and a desk request for the same change share the approval).

Empty/blocked states: policy not `active|bound` → "This cover is not on risk;
endorsement is unavailable" with the reinstate/renew links as the exits.

### D.5 Cancellation — `axis/policies/:id/cancel`

`route("axis/policies/:id/cancel", "routes/policy-cancel.tsx")`

Loader (`axis:policies:cancel`): `{ policy, currentVersion, reasonCodes,
refundPreview }` where the preview is a GET-safe pro-rata calculation
(`POST /v1/axis/policies/:id/cancel/preview` — POST because it takes an
effective date, but it writes nothing).

Action `cancel`: `{ effectiveAt, reasonCode, refundMethod, note }` →
`POST /v1/axis/policies/:id/cancel`. When `refundMinor > 0` the screen states,
before submit, that a second approver is required — dual control is announced,
not discovered.

Also serves NTU: if `policy.status === "bound"` and `now < startAt`, the screen
switches its verb to NTU and posts to `/ntu`. One screen, because it is one
decision with two dates.

### D.6 Underwriting referral desk — `axis/referrals`

`route("axis/referrals", "routes/uw-referrals.tsx")`

Loader (`axis:policies:decide_referral`): open `axis_referrals` ordered by
`slaDueAt`, each with its trigger rendered as a plain sentence from
`triggerJson` (which rule, which value, which limit).

Action intents: `accept` (writes the approval, unblocks the bind),
`decline` (with reason), `counter` (`counterTermsJson`, returns to the quote
desk), `refer-up` (raises to the next authority tier).

Empty state: "Nothing outside authority" plus the authority table as read-only
reference, so the desk can see the limits it is enforcing.

### D.7 Renewal desk — `axis/renewals`

`route("axis/renewals", "routes/renewal-desk.tsx")`

`orbit_renewals` already exists (`packages/db/src/schema/orbit.ts:57-82`) with
`churnScore`, `strategy`, `state`. This screen is the AXIS operator view of it,
not a second table: loader joins `orbit_renewals` (state `scheduled|offered`) to
the policy head.

Columns: expiry, holder, current gross, requoted best, delta, churn score,
strategy, owner, days to expiry.

Action intents: `requote` (fires the panel fan-out for the successor term),
`offer` (drafts the renewal invitation — ORBIT sends it, AXIS does not),
`bind-renewal` → `POST /v1/axis/policies/:id/renew`, `lapse-intent` (marks
`do_not_contact`).

Empty state: "No terms expiring in the next 60 days."

### D.8 Complaints register — `axis/complaints`; SIU queue — `axis/siu`

`route("axis/complaints", "routes/complaints.tsx")` (`axis:complaints:read`) —
list ordered by `dueAt` with the regulatory clock rendered as a countdown;
detail is the generic record screen. Intents: `acknowledge`, `investigate`,
`resolve` (outcome + `redressMinor`; redress > 0 requires `axis.claim_exgratia`
because it is money out), `escalate`, `close`.

`route("axis/siu", "routes/siu-queue.tsx")` (`axis:siu:read`) — ordered by
`score` desc, each row showing the top three indicators from `reasonsJson` with
their evidence links. Intents: `investigate`, `substantiate` (records
`savedMinor`), `clear`, `close`. A cleared referral writes back
`claims.siuState = null` and never silently changes the claim's state — SIU
advises, the handler decides.

Empty states: "No open complaints" / "Nothing referred."

### D.9 `axis-board.tsx` fixes (P2)

Three defects, all named in the file's own comments:

1. **No transitions.** The header comment at `:36-40` says the move buttons
   belong here once `POST /v1/axis/cases/:id/transition` exists. §D.10 creates
   it; the board gains a per-card move control whose legal targets come from the
   case machine (same `canTransition` idiom), each posting
   `intent="transition"` with `{ to, reason }`.
2. **Sorts by lateness only.** `byUrgency(now)` at `:211-218` orders late-first
   then `slaDueAt` then `createdAt`. Replace with a scorer that uses all three
   dimensions:

```ts
// value × risk × SLA, each normalized 0..1, weights in axis_ops_policies
export function priorityScore(c: BoardCase, now: number, w = WEIGHTS): number {
  const value = Math.min(1, (c.valueMinor ?? 0) / w.valueCapMinor);
  const risk  = (c.riskScore ?? 50) / 100;
  const sla   = c.slaDueAt == null ? 0.5
              : c.slaDueAt <= now ? 1
              : Math.max(0, 1 - (c.slaDueAt - now) / w.slaHorizonMs);
  return w.value * value + w.risk * risk + w.sla * sla;
}
export const WEIGHTS = { value: 0.4, risk: 0.2, sla: 0.4,
                         valueCapMinor: 5_000_00, slaHorizonMs: 72 * 3_600_000 };
```
   Ties break on `slaDueAt` then `createdAt`, so the sort stays deterministic.
3. **`WIP_WARN = 12` hardcoded** at `:77` with its own `// ponytail:` note
   admitting it. Read it from `axis_ops_policies` key `axis.board`
   (`{ wipWarn: { quoting: 12, review: 8 }, weights: {...} }`), falling back to
   the current constant when the row is absent. The fallback stays exported so
   the existing test keeps its anchor.

Fourth, smaller: `axis-board.tsx` builds its labels with a locale-only
`labelsIn(locale)`. Switch to `labelsFrom(LABELS)(locale, pack)` — a board that
says "Cases"/"Quotes" to a `retail-ecom` tenant violates `CLAUDE.md` §14.

### D.10 API surfaces

`apps/api/src/routes/axis.ts` (currently 357 lines of document/copilot/SOP
handlers) gains a lifecycle block. Every one of these wraps `withIdempotency`
(`packages/core/src/idempotency.ts:16`), calls `must()`
(`apps/api/src/rows.ts:21`) for the subject, `require_()` for the permission,
`runTxn` for the hop, and `audit()` afterwards.

```
POST /v1/axis/policies/:id/bind            axis:policies:bind      BIND
POST /v1/axis/policies/:id/endorse/preview axis:policies:endorse   (no write)
POST /v1/axis/policies/:id/endorse         axis:policies:endorse   ENDORSE
POST /v1/axis/policies/:id/cancel/preview  axis:policies:cancel    (no write)
POST /v1/axis/policies/:id/cancel          axis:policies:cancel    CANCEL
POST /v1/axis/policies/:id/ntu             axis:policies:ntu       NTU
POST /v1/axis/policies/:id/lapse           axis:policies:lapse     LAPSE
POST /v1/axis/policies/:id/reinstate       axis:policies:reinstate REINSTATE
POST /v1/axis/policies/:id/renew           axis:policies:renew     RENEW  (creates successor head)
POST /v1/axis/policies/:id/documents       axis:policies:document  (generate schedule)
GET  /v1/axis/policies/:id/versions        axis:policies:read
POST /v1/axis/quote-responses/:id/bind     axis:policies:bind      BIND from a fan-out response

POST /v1/axis/claims                       axis:claims:register    FNOL-REGISTER
POST /v1/axis/claims/coverage-check        axis:claims:register    (no write)
POST /v1/axis/claims/:id/transition        axis:claims:triage|…    per §B.2
POST /v1/axis/claims/:id/reserves          axis:claims:reserve     CLAIM-RESERVE
POST /v1/axis/claims/:id/payments          axis:claims:pay         CLAIM-PAY
POST /v1/axis/claims/:id/recoveries        axis:claims:recover     RECOVERY-OPEN
POST /v1/axis/recoveries/:id/receipt       axis:claims:recover     RECOVERY-RECEIPT
POST /v1/axis/recoveries/:id/writeoff      axis:claims:recover     RECOVERY-WRITEOFF

POST /v1/axis/cases/:id/transition         axis:cases:update       (the board's missing verb)
POST /v1/axis/bordereaux                   axis:bordereaux:generate
POST /v1/axis/bordereaux/:id/reconcile     axis:bordereaux:reconcile
POST /v1/axis/referrals/:id/decide         axis:policies:decide_referral
```

`GET /v1/axis/policies/:id/versions` is what
`apps/web/app/routes/policy-detail.tsx:229-236` calls instead of the
`customerId` query. That one-line loader change is the visible half of F5.

Why lifecycle routes and not the generic CRUD approval hook in
`apps/api/src/resources.ts:245-307`: the generic hook can gate a create on
`axis.bind` with `amountField: "premiumMinor"`, but it cannot append a version,
compute pro-rata, chain a refund child transaction or enforce a state machine.
The `policies` resource keeps its hook for admin corrections and loses `create`
from every non-admin role.

### D.11 Policy document generation (F27)

`POST /v1/axis/policies/:id/documents` `{ kind: "schedule"|"certificate"|"endorsement"|"cancellation", versionId? }`.

Renders from a tenant template (`axis_sops`-style versioned rows are not needed —
templates live in `core_templates`, already used by ORBIT), stores the PDF in R2
via the existing file service, writes `core_files`, sets
`axis_policy_versions.documentFileId`, and emits `axis.policy.document_issued`.
Delivery is ORBIT's job: AXIS emits, ORBIT sends, and
`axis_policy_versions.deliveredAt` is stamped by the resulting
`orbit.message.delivered` handler.

This is what `apps/api/src/axis-zero-touch.test.ts:217-234` substitutes an
analytics export for today. That substitution is deleted in §H task 10.

---

## E. Reporting

All five are read models over the tables in §C, served by
`apps/api/src/engines/report.ts` (already the home of report generation) and
surfaced through the existing analytics report screens. None gets a bespoke
table; a report that needs speed gets a `north_snapshots` row (§F), not a
materialized view.

### E.1 Outbound premium bordereau

Per provider, per month. One line per `axis_policy_versions` row whose
`effectiveFrom` falls in the period, for policies of that provider.
Columns: external policy no, risk ref, holder, cover from/to, transaction type
(new/MTA/cancellation/renewal), gross premium, tax, net, commission, currency.
Totals reconcile to `Σ dist_commission_entries` for the period — a variance is a
generation failure, not a footnote.

### E.2 Outbound claims bordereau

Per provider, per month. One line per claim with movement in the period:
claim no, policy no, incident date, notified date, peril, status, paid in
period, cumulative paid, outstanding reserve, recovered, incurred.

### E.3 Inbound bordereau reconciliation

Provider sends a file (CSV/XLSX) → `sourceFileId` → parsed into
`axis_bordereau_lines` with `rawJson` preserved verbatim →
`POST /v1/axis/bordereaux/:id/reconcile` matches on
`(externalRef)` then `(policyNo, effectiveFrom)` then `(riskRef, effectiveFrom)`,
in that order, first match wins. Each line lands on
`matched | variance | missing_ours | missing_theirs`. `variance` rows carry
`varianceMinor` and feed the existing exceptions screen
(`apps/web/app/routes/axis-exceptions.tsx`); `missing_theirs` is the escrow
shortfall that `axis_escrow_batches` already models, so the bordereau links to
its batch rather than re-implementing the money side.

### E.4 Production report, loss run, triangle, retention

| Report | Grain | Source |
|---|---|---|
| Production | month × provider × channel × product line | `axis_policy_versions` joined to head; splits new business / renewal / MTA / cancellation by `reason` and `renewalSeq` |
| Loss run | policy or holder, all-time | `axis_claims` + `axis_claim_payments` + latest `axis_claim_reserves` per head; one row per claim, columns paid/outstanding/recovered/incurred |
| Claims triangle | accident-period rows × development-period columns | `axis_claim_reserves.setAt` and `axis_claim_payments.paidAt` give the as-at snapshots that make a triangle possible — this report is the reason reserve history is a table (§C.4) |
| Renewal retention | month × product line × channel | `axis_policies.renewedFromPolicyId`: retained = successor exists and is `bound|active`; lapsed/lost = prior term ended `expired` with no successor |

Triangles are computed paid-basis and incurred-basis from the same query, with
development periods in months from the accident period start. Cumulative, not
incremental, because every actuary asks for cumulative and the incremental view
is one subtraction away in the UI.

---

## F. Analytics / KPIs

Metric definitions are typed compute functions in
`apps/api/src/engines/north-snapshotter.ts` (ADR-0024:
`north_metrics.definition_sql_ref` is documentation, not parseable SQL). Rates
are stored as basis points (`Math.round((x / y) * 10_000)`), money in minor
units, and `null` means not-applicable for that grain — all three conventions
already exist in that file. Grains: `day` (yesterday) and `month`
(month-to-date), from `periodsFor(now)`.

New rows in `north_metrics` (`packages/db/src/schema/north.ts`) and new entries
in the snapshotter registry (currently ten keys at `:197-206`):

| Metric key | Unit | Dir | Computation |
|---|---|---|---|
| `gross_written_premium` | money | up | `Σ axis_policy_versions.premiumMinor + taxMinor + feesMinor` where `effectiveFrom` in period and `state != "voided"` |
| `net_written_premium` | money | up | as above, `premiumMinor` only |
| `loss_ratio` | ratio (bp) | down | `(Σ paidMinor + Σ current reserveMinor − Σ recoveredMinor) / earnedPremiumMinor`, claims by **accident period**, earned premium pro-rata over each version's `[effectiveFrom, effectiveTo)` |
| `expense_ratio` | ratio (bp) | down | `Σ ledger 5xxx accounts for the period / earnedPremiumMinor` |
| `combined_ratio` | ratio (bp) | down | `loss_ratio + expense_ratio` — computed from the two snapshots, not re-queried |
| `renewal_retention` | percent (bp) | up | `count(policies with renewedFromPolicyId set, bound in period) / count(prior terms expiring in period)` |
| `quote_hit_rate` | percent (bp) | up | `count(BIND txns) / count(dist_quote_requests created)` — distinct from the existing `quote_to_bind_rate`, which is response-level |
| `avg_handling_time_claims` | duration_ms | down | median (not mean — one litigated claim ruins a mean) of `closedAt − reportedAt` for claims closed in period |
| `avg_handling_time_cases` | duration_ms | down | median `closedAt − createdAt` over `axis_cases` closed in period |
| `reserve_adequacy` | ratio (bp) | up | for claims closed in period: `Σ reserve at 30 days after report / Σ final paid`. 10_000 bp = spot on; below = under-reserved |
| `sla_breach_rate` | percent (bp) | down | `count(cases + claims closed past slaDueAt) / count closed` |
| `claims_leakage` | money | down | `Σ (paid − assessed_should_have_paid)` where the SIU or an audit recorded a delta, plus `Σ axis_siu_referrals.savedMinor` as the offsetting recovery — reported as a pair, never netted into one number |
| `open_claim_count` | count | down | claims not in `closed|withdrawn|rejected` at period end |
| `outstanding_reserve` | money | — | `Σ axis_claims.reserveMinor` at period end |

Dimensions snapshotted (`north_snapshots.dimsJson` + `dimsHash`, where `""` is
the grand total): `providerId`, `channelId`, `productLine`. Three dimensions,
not five, because `north_snapshots_uq` is a row per combination and a claims
triangle does not belong in a snapshot table.

Grain choice: money and count metrics at `day` and `month`; ratios at `month`
only (a daily loss ratio on a small book is noise, and `null` is the documented
way to say so).

`packages/core/src/claims.ts:incurred()` and a new
`packages/core/src/premium.ts:earnedBetween(version, from, to)` are the two
shared functions every metric above calls, so "earned premium" has exactly one
definition in the codebase.

---

## G. AI at the core

Every model call goes through `c.get("gateway").complete(...)` and lands in
`ai_audit_log` with tenant, module, purpose, actor (`CLAUDE.md` §3). Every
artifact renders with the ✦ marker and an inspectable "why" (§11). Prompts read
their nouns from the active domain pack, never a literal `"policy"` (§14) —
the vocabulary helper in `apps/web/app/modules/vocabulary.ts` grows a
server-side twin, `packages/core/src/vocabulary.ts:promptNouns(pack, locale)`,
because ADR-0022 explicitly deferred the prompt side and these seven surfaces
are what un-defers it.

**AI never binds and never pays.** No surface below writes a `BIND`, `CLAIM-PAY`
or any `payout: true` transaction. Every one of them either proposes a draft or
writes a non-financial artifact that a human then acts on.

Eval cases live in `packages/model-gateway/evals/axis/`, extending the existing
`cases.jsonl` + `thresholds.json` pair (currently
`{ "fieldAccuracyMin": 0.95 }` for document extraction). Each surface adds its
own subdirectory so thresholds do not collide.

### G.1 FNOL triage — `evals/axis/fnol-triage/`

Input: the FNOL free text plus structured incident fields. Output:
`{ perilCode, causeCode, complexity, severityBand, suggestedReserveBand,
   missingInfo[], siuIndicators[] }`.

Human boundary: writes nothing to `axis_claims` except as **ghost text** in the
intake form; the handler accepts field by field. Coverage is never decided by
the model — `POST /v1/axis/claims/coverage-check` is deterministic SQL against
`axis_policy_versions`.

Evidence cited: the phrase spans in the notification that drove each field, plus
the product wording clause for the peril.

Thresholds: `perilAccuracyMin: 0.90`, `complexityAccuracyMin: 0.80`,
`missingInfoRecallMin: 0.85`, `falseSevereRateMax: 0.05`. 40 cases, en + ar,
including five deliberately ambiguous notifications where the expected output is
`complexity: "complex"` and a populated `missingInfo`.

### G.2 Fraud scoring — `evals/axis/fraud/`

Input: claim, policy version, holder claim history, document extraction results.
Output: `{ score: 0-100, indicators: [{ code, weight, evidenceRef }] }` written
to `axis_siu_referrals` when `score >= tenant threshold`.

Human boundary: a referral is a queue entry, never a declinature. The model may
not set `claims.status`, may not reduce a reserve and may not block a payment —
it can only put the claim in front of an investigator. A substantiated referral
is recorded by a human with `outcome` and `savedMinor`.

Evidence cited: each indicator names its evidence (a document field, a prior
claim id, a network link). An indicator with no `evidenceRef` is dropped before
scoring — no unexplainable points.

Thresholds: `precisionAtTop10Min: 0.40`, `recallMin: 0.70`,
`unexplainedIndicatorRateMax: 0.0`, and a fairness check
`maxScoreDeltaByProtectedProxy: 5` points across held-out cohorts. 60 cases,
half genuine.

### G.3 Reserve recommendation — `evals/axis/reserve/`

Input: peril, cause, severity signals, comparable closed claims (same peril,
same product, last 24 months), policy limits and excess. Output:
`{ recommendedMinor, band: [lowMinor, highMinor], confidence, comparables[] }`.

Human boundary: writes an `axis_claim_reserves` row only with
`basis: "ai_recommended"`, `setBy: "agent:reserve-advisor"`, and only below the
handler's authority limit; at or above it the recommendation is a draft on the
claim, not a row. Any accepted recommendation records the human in
`setBy` — the model's involvement survives in `aiAuditId`, so the audit trail
shows both.

Evidence cited: the comparable claim ids and their outcomes, plus the limit that
capped the band.

Thresholds: `medianAbsPctErrorMax: 0.25`, `bandCoverageMin: 0.80` (final paid
falls inside the band 80% of the time), `overReserveBiasMax: 0.10`. 50 closed
claims held out by report date, never by random split — a random split leaks the
future.

### G.4 SLA-breach prediction — `evals/axis/sla/`

Input: case/claim age, current state, state history from `axis_process_events`,
queue depth, owner load. Output: `{ breachProbability, hoursToBreach, driver }`.

Human boundary: reprioritizes a queue and drafts a chase; it never reassigns
work (that is `axis:cases:assign`, held by a human) and never extends an SLA.

Evidence: the driver is one of the observed features with its value ("awaiting
docs 6 days, median for this peril is 2").

Thresholds: `aucMin: 0.75`, `calibrationErrorMax: 0.10` (predicted vs observed
breach rate in deciles), `leadTimeMedianHoursMin: 24` — a warning that arrives an
hour before the breach is not a warning.

### G.5 Document intelligence beyond `rawText`

Today `ExtractBody` at `apps/api/src/routes/axis.ts:73-78` requires the caller to
supply `rawText`, which means the platform does not actually read documents — it
reads text someone else extracted.

Fix: `POST /v1/axis/documents/:id/extract` takes `{ fileId }` and runs a
two-stage pipeline — page render → vision model over the page images via the
gateway, with `rawText` kept as an optional override for tests and for text-layer
PDFs where OCR is wasted. The existing `docType`-keyed extraction schema and the
`verify` flow are unchanged.

Human boundary: unchanged and already right — extraction writes
`status: "extracted"`, and `axis:documents:verify` is what promotes it. Fields
below `extractionConfidence` threshold render as ghost text requiring per-field
confirmation.

Evidence: bounding box + page number per extracted field, stored in
`extractionJson`, so "why" is a highlight on the source image.

Thresholds: existing `fieldAccuracyMin: 0.95` retained and now measured
end-to-end from the image rather than from supplied text; add
`pageRoutingAccuracyMin: 0.98` (right doc type from the image alone) and
`hallucinatedFieldRateMax: 0.0` — a field not present on the page must come back
null, never guessed.

### G.6 Prioritiser, Chaser, Issuer agents

Named in `docs/modules/axis.md` §3; here is where their boundary sits.

- **Prioritiser** — computes `priorityScore` (§D.9) plus a model term for
  "likely to stall". Writes queue order only. No state change, no assignment.
  Eval `evals/axis/prioritiser/`: `spearmanVsExpertMin: 0.70` against a
  hand-ranked backlog of 100 cases.
- **Chaser** — drafts the follow-up for a missing document or an unanswered
  underwriter. `consequential: true` on send; the draft sits in ORBIT's outbox
  and a human releases it unless the tenant's `auto_approve` allowlist covers
  `orbit.message.send` for that template. Eval:
  `groundednessMin: 0.95` via the existing `verifyGroundedness` helper —
  a chase that invents a missing document is worse than no chase.
- **Issuer** — assembles the bind package (documents complete, referrals
  cleared, premium collected, approval present) and **stops**. It calls
  `POST /v1/axis/policies/:id/bind` only when the tenant has explicitly
  allowlisted `BIND` for auto-approval and the amount is under the bind
  threshold; otherwise it raises the approval and waits. This is the zero-touch
  path in `docs/modules/axis.md` §8, and it is the one place a model touches a
  financial transaction — through the same `gate()` a human would face, with
  `actorKind: "agent"` on the transaction so the audit shows it.
  Eval `evals/axis/issuer/`: `falseReadyRateMax: 0.0` (never declares ready with
  a missing prerequisite), `readyRecallMin: 0.90`.

---

## H. Implementation plan

Ordered. Each task is independently testable and names its failing test first.
Every task follows red → green → refactor; the test file and test name below are
what gets committed before the implementation.

**1. Policy state machine (no schema change).**
Test: `packages/core/src/lifecycle.test.ts` → `"refuses a hop from cancelled to active"`,
`"allows lapsed -> active for reinstatement"`.
Impl: `packages/core/src/lifecycle.ts` per §B.1/§B.2.

**2. Policy versioning schema + invariants.**
Test: `packages/db/src/policy-versions.test.ts` →
`"exactly one effective version per policy"`,
`"version intervals are contiguous and non-overlapping"`,
`"0016 backfill creates a v1 for every existing policy"`.
Impl: §C.1, §C.2, migration `0016`.

**3. Bind endpoint from a quote response (F4).**
Test: `apps/api/src/axis-bind.test.ts` →
`"binds a selected dist_quote_response into a policy with version 1"`,
`"is idempotent under a replayed idempotency key"`,
`"refuses to bind twice from the same response"`.
Impl: `POST /v1/axis/quote-responses/:id/bind` + `POST /v1/axis/policies/:id/bind`;
`dist.ts:258` (`/quote-requests/:id/select`) stops being the end of the road and
emits `dist.quote_response.selected` for the bind path to consume; remove
`axis:policies:create` from `axis.lead` and `axis.underwriter`.

**4. F13 resolution.**
Test: `apps/api/src/axis-quotes-source.test.ts` →
`"a manually keyed quote lands in dist_quote_responses, not axis_quotes"`,
`"seed produces a policy version pointing at a dist_quote_response"`.
Impl: §C.10 — seed change at `packages/core/src/seed.ts:770-810`, `quotes`
resource demoted to read-only in `apps/api/src/resources.ts`, `@deprecated` on
the table.

**5. Endorsement (F5, part 1).**
Test: `apps/api/src/axis-endorse.test.ts` →
`"appends version 2 and leaves the policy number unchanged"`,
`"a negative premium delta requires dual control"`,
`"an agent-raised and desk-raised endorsement of the same change-set share one approval"`.
Impl: preview + endorse endpoints, `ENDORSE` through `runTxn`,
`orbit-tools.ts:117-163` rewired to call the endpoint instead of hand-rolling
its own `gate()` + case row.

**6. Cancel / lapse / reinstate / NTU / expire (F5, part 2).**
Test: `apps/api/src/axis-lifecycle.test.ts` →
`"cancellation with a pro-rata refund posts CANCEL and a child REFUND-ISSUE"`,
`"cancellation with nil refund needs no second approver"`,
`"lapse fires after grace and emits orbit.renewal.lost"`,
`"reinstatement always needs dual control"`,
`"NTU before inception claws back commission"`.
Impl: the five endpoints, the two `TXN_TYPES` rows, the two amended approval
policies (§A.3), scheduler entries in `apps/agents` for `INCEPT`/`EXPIRE`/`LAPSE`.

**7. Claim money model (F23).**
Test: `packages/db/src/claim-reserves.test.ts` →
`"reserve history is append-only"`,
`"claims.reserveMinor equals the sum of the latest row per head"`,
`"reserve as at a past date reads the history, not the head"`.
Impl: §C.3–C.6, migration `0017`, `packages/core/src/claims.ts:incurred()`.

**8. Claim payment + recovery (F23 cont.).**
Test: `apps/api/src/axis-claim-payment.test.ts` →
`"a claim payment cannot be auto-approved even on the tenant allowlist"`,
`"two payment requests with one idempotency key produce one ledger transaction"`,
`"paid total never exceeds funded float"` (property),
`"recovery receipt splits the fee to 4090"`.
Impl: recipes + catalogue rows (§B.3/§B.4), payment and recovery endpoints,
chart-of-accounts additions to `docs/19 §5.1`, property obligation eleven in
`docs/19 §11`.

**9. FNOL + coverage check (F24).**
Test: `apps/api/src/axis-fnol.test.ts` →
`"a claim records the policy version in force at the incident date"`,
`"an incident before inception registers with coverageState not_yet_incepted"`,
`"an out-of-cover notification is still recorded"`.
Impl: `POST /v1/axis/claims/coverage-check`, FNOL route, `FNOL-REGISTER` wiring.

**10. Document generation (F27) and the zero-touch test told straight.**
Test: `apps/api/src/axis-zero-touch.test.ts` → the substitution at `:217-234`
(an analytics export standing in for a policy PDF) is replaced by
`"issues a schedule PDF and attaches it to version 1"`; the hand-assembled bind
at `:183` is replaced by the real bind endpoint from task 3.
Impl: `POST /v1/axis/policies/:id/documents`, template rendering, R2 write,
`axis.policy.document_issued`.

**11. Web surfaces.**
Test: `apps/web/app/routes/policy-detail.test.tsx` →
`"endorsement history shows only versions of this policy"` (the F5 regression
against `:229-236`); `apps/web/app/routes/claim-detail.test.tsx` →
`"the reserve control appends rather than overwrites"`;
`e2e/axis-lifecycle.spec.ts` tagged `@journey:J-…` for FNOL → triage → reserve →
approve → pay.
Impl: §D.1–D.8, plus the `policy-detail.tsx` loader switch to
`/v1/axis/policies/:id/versions`.

**12. Board fixes (P2).**
Test: `apps/web/app/routes/axis-board.test.tsx` →
`"orders by value, risk and SLA together"`,
`"a card offers only legal transitions"`,
`"WIP warning reads tenant policy and falls back to 12"`,
`"lane names come from the domain pack"`.
Impl: §D.9.

**13. Bordereaux (P2).**
Test: `apps/api/src/axis-bordereaux.test.ts` →
`"an outbound premium bordereau totals to the period's commission entries"`,
`"an inbound line with no local match lands as missing_ours"`,
`"regenerating the same period is idempotent"`.
Impl: migration `0018`, generation + reconciliation endpoints, §E.1–E.3.

**14. Referrals, complaints, SIU.**
Test: `apps/api/src/axis-referrals.test.ts` →
`"a bind above delegated authority creates a referral instead of a policy"`;
`apps/api/src/axis-conduct.test.ts` →
`"a complaint past its regulatory due date surfaces on the exceptions screen"`.
Impl: migration `0019`, §D.6, §D.8, the `axis.authority` ops-policy reader.

**15. Metrics.**
Test: `apps/api/src/engines/north-snapshotter.test.ts` →
`"loss ratio is null at day grain and a basis-point integer at month grain"`,
`"retention counts a renewed term once"`,
`"reserve adequacy uses the 30-day reserve, not the current one"`.
Impl: §F — registry functions, `north_metrics` seed rows,
`packages/core/src/premium.ts:earnedBetween`.

**16. AI surfaces, eval-first.**
Test: the eval sets themselves, in order — `evals/axis/fnol-triage/`,
`evals/axis/reserve/`, `evals/axis/fraud/`, `evals/axis/sla/`,
`evals/axis/issuer/`, then the `rawText` removal in
`evals/axis/` (existing extraction set, re-measured from images).
Impl: §G. No prompt is written before its golden set and thresholds exist.

Ordering rationale: 1–6 make the contract real, 7–10 make the claim real,
11–12 make them operable, 13–15 make them measurable, 16 makes them fast. Each
block is shippable on its own; nothing after 6 can regress 1–6 because the state
machine tests run on every commit.

---

## Where the existing code fights this design

Two real obstacles and one nuisance. None is fatal; all three need a decision
recorded rather than a workaround.

1. **`axis_policies_no_uq` on `(tenantId, providerId, policyNo)`**
   (`packages/db/src/schema/axis.ts:151`) makes multi-row versioning impossible
   without changing an applied index, which migrations-are-forward-only
   discourages. The design routes around it by putting versions in a child
   table — but that means the head row's `premiumMinor`, `startAt` and `endAt`
   are now denormalizations of the effective version, and nothing in the
   database enforces that. It is enforced by the invariant tests in §H task 2
   and by the rule that only the lifecycle endpoints write the head. A tenant
   whose insurer reuses one policy number across two providers would break the
   index; that is a pre-existing constraint, not a new one.

2. **`docs/19 §4` has no claims vocabulary at all.** There is no reserve,
   payment, recovery or NTU code in `TXN_TYPES`, no claims account in the chart
   of accounts (§5.1), and no claims row in the approval table (§7). Nine new
   transaction codes, four new account codes and one new property-test
   obligation are additions to a document `CLAUDE.md` treats as the source of
   truth. §B.3/§B.4 specifies them, but they should land as an ADR plus a
   docs/19 edit in the same PR as §H task 8 — the spec wins over the code, so
   the spec has to move first.

3. **`apps/api/src/resources.ts:245-307` registers `policies` with
   `{ approval: { create: "axis.bind", amountField: "premiumMinor" } }`,** and
   the web endorsement action at
   `apps/web/app/routes/policy-detail.tsx:257-305` relies on exactly that path.
   Until §H task 3 lands, the generic create is the only way to make a policy,
   so tasks 1–2 cannot remove it. The sequencing above keeps both paths alive
   through task 4 and closes the generic one in task 5, which means there is a
   two-task window where a caller with `axis:policies:create` can still
   hand-assemble a policy that skips version 1. The window is covered by the
   `0016` backfill (any such policy gets a v1) and closed for good in task 5.
