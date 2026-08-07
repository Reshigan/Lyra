import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// docs/03 §AXIS — operations. Case is the unit of work.

export const cases = sqliteTable(
  "axis_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ref: text("ref").notNull(), // human-facing short ref, unique per tenant
    kind: text("kind").notNull(), // quote|bind|endorse|renewal_ops|group_medical|kyc|claim
    customerId: text("customer_id"),
    productLine: text("product_line"),
    channelId: text("channel_id"), // -> dist_channels.id, where the case came from
    quoteRequestId: text("quote_request_id"), // -> dist_quote_requests.id, the comparative shop
    status: text("status").notNull().default("intake"), // intake|quoting|awaiting_docs|review|approval|issued|failed|cancelled
    slaDueAt: integer("sla_due_at"),
    ownerRef: text("owner_ref"), // user:<id> | agent:<key>
    teamId: text("team_id"),
    priority: text("priority").notNull().default("normal"), // low|normal|high|urgent
    source: text("source").notNull().default("web"), // web|orbit|partner|import|api|agent
    riskScore: integer("risk_score"),
    valueMinor: integer("value_minor"),
    currency: text("currency"),
    metaJson: text("meta_json"),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at")
  },
  (t) => [
    index("axis_cases_tenant_idx").on(t.tenantId, t.status, t.slaDueAt),
    index("axis_cases_owner_idx").on(t.tenantId, t.ownerRef, t.status),
    index("axis_cases_customer_idx").on(t.tenantId, t.customerId),
    // Partial: a soft-deleted case must not block reusing its ref.
    uniqueIndex("axis_cases_ref_uq").on(t.tenantId, t.ref).where(sql`deleted_at IS NULL`)
  ]
);

/**
 * @deprecated docs/27 F13 / docs/specs/gap-axis-design.md §C.10. Two tables
 * held one concept; `dist_quote_responses` won. Nothing writes here any more —
 * a hand-keyed quote goes to POST /v1/axis/cases/:id/quotes, which files it as
 * a quote response. Kept readable for cases quoted before the change; the
 * removal migration waits until those have aged out (migrations are
 * forward-only, so dropping it is a one-way door).
 */
export const quotes = sqliteTable(
  "axis_quotes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull(),
    providerId: text("provider_id").notNull(),
    offeringId: text("offering_id"), // -> dist_offerings.id
    responseId: text("response_id"), // -> dist_quote_responses.id when it came from a fan-out
    premiumMinor: integer("premium_minor").notNull(),
    currency: text("currency").notNull(),
    coverageJson: text("coverage_json"),
    validUntil: integer("valid_until"),
    winFlag: integer("win_flag", { mode: "boolean" }).notNull().default(false),
    declineReason: text("decline_reason"),
    source: text("source").notNull().default("manual"), // manual|api|portal|ai_extract
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("axis_quotes_tenant_idx").on(t.tenantId, t.caseId),
    index("axis_quotes_provider_idx").on(t.tenantId, t.providerId, t.createdAt)
  ]
);

export const documents = sqliteTable(
  "axis_documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull(),
    fileId: text("file_id").notNull(),
    docType: text("doc_type").notNull(), // eid|mulkiya|census|medical|tradelicense|other
    extractionJson: text("extraction_json"),
    extractionConfidence: integer("extraction_confidence"), // 0-100
    extractionModel: text("extraction_model"),
    verifiedBy: text("verified_by"),
    verifiedAt: integer("verified_at"),
    status: text("status").notNull().default("received"), // received|extracting|extracted|verified|rejected
    createdAt: integer("created_at").notNull()
  },
  (t) => [index("axis_documents_tenant_idx").on(t.tenantId, t.caseId, t.docType)]
);

export const tasks = sqliteTable(
  "axis_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id"),
    type: text("type").notNull(),
    titleKey: text("title_key").notNull(),
    assigneeRef: text("assignee_ref"),
    state: text("state").notNull().default("open"), // open|in_progress|blocked|done|cancelled
    dueAt: integer("due_at"),
    checklistJson: text("checklist_json"),
    createdBy: text("created_by").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("axis_tasks_tenant_idx").on(t.tenantId, t.state, t.dueAt),
    index("axis_tasks_assignee_idx").on(t.tenantId, t.assigneeRef, t.state)
  ]
);

/** Module-local approval rows mirror core_approvals for case-scoped queries. */
export const approvals = sqliteTable(
  "axis_approvals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    approvalId: text("approval_id").notNull(), // -> core_approvals.id
    caseId: text("case_id").notNull(),
    subjectRef: text("subject_ref").notNull(),
    policyKey: text("policy_key").notNull(),
    decision: text("decision").notNull().default("pending"),
    ts: integer("ts").notNull()
  },
  (t) => [index("axis_approvals_tenant_idx").on(t.tenantId, t.caseId, t.decision)]
);

export const policies = sqliteTable(
  "axis_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id"),
    customerId: text("customer_id").notNull(),
    providerId: text("provider_id").notNull(),
    productId: text("product_id"),
    offeringId: text("offering_id"), // -> dist_offerings.id, the underwriter's variant sold
    channelId: text("channel_id"), // -> dist_channels.id, who sold it — drives commission split
    policyNo: text("policy_no").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    premiumMinor: integer("premium_minor").notNull(),
    currency: text("currency").notNull(),
    commissionMinor: integer("commission_minor").notNull().default(0),
    docsJson: text("docs_json"),
    escrowBatchId: text("escrow_batch_id"),
    paymentPlanJson: text("payment_plan_json"), // H9 reserved
    // docs/27 F5. The head row is the contract; terms live in axis_policy_versions.
    // premiumMinor/startAt/endAt above are denormalizations of the effective
    // version and are written only by the lifecycle endpoints.
    currentVersionId: text("current_version_id"), // -> axis_policy_versions.id
    versionSeq: integer("version_seq").notNull().default(1),
    taxMinor: integer("tax_minor").notNull().default(0),
    feesMinor: integer("fees_minor").notNull().default(0),
    grossMinor: integer("gross_minor").notNull().default(0), // premium + tax + fees
    renewedFromPolicyId: text("renewed_from_policy_id"), // prior term, same risk
    renewalSeq: integer("renewal_seq").notNull().default(0), // 0 = new business
    inceptedAt: integer("incepted_at"),
    lapsedAt: integer("lapsed_at"),
    cancelledAt: integer("cancelled_at"),
    cancelReasonCode: text("cancel_reason_code"),
    cancelEffectiveAt: integer("cancel_effective_at"), // may differ from cancelledAt
    statusReason: text("status_reason"),
    lastTxnId: text("last_txn_id"), // -> ledger_txns.id
    status: text("status").notNull().default("active"),
    // draft|bound|active|lapsed|cancelled|expired|renewed|ntu — POLICY_STATES in
    // packages/core/src/lifecycle.ts is the authority.
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("axis_policies_tenant_idx").on(t.tenantId, t.endAt),
    index("axis_policies_customer_idx").on(t.tenantId, t.customerId),
    index("axis_policies_renewal_idx").on(t.tenantId, t.renewedFromPolicyId),
    uniqueIndex("axis_policies_no_uq").on(t.tenantId, t.providerId, t.policyNo)
  ]
);

/**
 * docs/27 F5 / design §C.2. Endorsement history is a real child list, not
 * "every policy sharing a customerId". One row per priced state of the
 * contract; `[effectiveFrom, effectiveTo)` intervals of the non-voided rows are
 * contiguous and non-overlapping, and exactly one is `effective` at a time.
 */
export const policyVersions = sqliteTable(
  "axis_policy_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(), // -> axis_policies.id
    versionSeq: integer("version_seq").notNull(), // 1 = as issued, dense
    endorsementNo: text("endorsement_no"), // insurer's ref, null on seq 1
    reason: text("reason").notNull(),
    // issue|endorsement|cancellation|reinstatement|renewal_rollover|correction
    reasonCode: text("reason_code"), // tenant taxonomy, e.g. mta.vehicle_change
    effectiveFrom: integer("effective_from").notNull(),
    effectiveTo: integer("effective_to").notNull(),
    premiumMinor: integer("premium_minor").notNull(),
    taxMinor: integer("tax_minor").notNull().default(0),
    feesMinor: integer("fees_minor").notNull().default(0),
    commissionMinor: integer("commission_minor").notNull().default(0),
    currency: text("currency").notNull(),
    premiumDeltaMinor: integer("premium_delta_minor").notNull().default(0), // signed vs prior
    proRataDays: integer("pro_rata_days"),
    termsJson: text("terms_json").notNull(), // cover, limits, excess, insured items
    ratingJson: text("rating_json"), // apps/api/src/engines/rating.ts output
    quoteResponseId: text("quote_response_id"), // -> dist_quote_responses.id (F13 seam)
    txnId: text("txn_id"), // -> ledger_txns.id that authorized it
    approvalId: text("approval_id"), // -> core_approvals.id
    documentFileId: text("document_file_id"), // -> core_files.id, this version's schedule
    deliveredAt: integer("delivered_at"),
    deliveryRef: text("delivery_ref"), // orbit message id
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

export const escrowBatches = sqliteTable(
  "axis_escrow_batches",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    period: text("period").notNull(), // YYYY-MM
    providerId: text("provider_id").notNull(),
    expectedMinor: integer("expected_minor").notNull().default(0),
    receivedMinor: integer("received_minor").notNull().default(0),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("open"), // open|reconciling|matched|variance|closed
    varianceReason: text("variance_reason"),
    evidenceFileId: text("evidence_file_id"),
    closedBy: text("closed_by"),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("axis_escrow_uq").on(t.tenantId, t.period, t.providerId)]
);

export const sops = sqliteTable(
  "axis_sops",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    nameJson: text("name_json").notNull(),
    stepsJson: text("steps_json").notNull(),
    appliesTo: text("applies_to"), // case kind
    status: text("status").notNull().default("draft"), // draft|active|retired
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [uniqueIndex("axis_sops_uq").on(t.tenantId, t.key, t.version)]
);

/** Normalized step events for process mining (docs/05 AXIS). */
export const processEvents = sqliteTable(
  "axis_process_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    caseId: text("case_id").notNull(),
    step: text("step").notNull(),
    actorRef: text("actor_ref").notNull(),
    durationMs: integer("duration_ms"),
    outcome: text("outcome"),
    ts: integer("ts").notNull()
  },
  (t) => [index("axis_process_events_idx").on(t.tenantId, t.caseId, t.ts)]
);

/** Tenant-configurable SLA, routing and queue policy (docs/03 §AXIS admin). */
export const opsPolicies = sqliteTable(
  "axis_ops_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").notNull(), // sla|routing|queue
    valueJson: text("value_json").notNull(),
    status: text("status").notNull().default("active"), // active|disabled
    updatedBy: text("updated_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("axis_ops_policies_key_uq").on(t.tenantId, t.key)]
);

/** Claims: the other consequential AXIS flow (guidance is regulated — docs/12). */
export const claims = sqliteTable(
  "axis_claims",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    customerId: text("customer_id").notNull(),
    caseId: text("case_id"),
    claimNo: text("claim_no").notNull(),
    incidentAt: integer("incident_at"),
    reportedAt: integer("reported_at").notNull(),
    amountMinor: integer("amount_minor"),
    settledMinor: integer("settled_minor"),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("reported"), // reported|assessing|approved|rejected|settled|withdrawn
    fnolJson: text("fnol_json"),
    assessorRef: text("assessor_ref"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("axis_claims_tenant_idx").on(t.tenantId, t.status, t.reportedAt),
    index("axis_claims_customer_idx").on(t.tenantId, t.customerId),
    uniqueIndex("axis_claims_no_uq").on(t.tenantId, t.claimNo)
  ]
);
