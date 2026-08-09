import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// docs/03 §ORBIT — customers, conversations, renewals, partners.

export const conversations = sqliteTable(
  "orbit_conversations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id"),
    channel: text("channel").notNull(), // whatsapp|web|voice|email|agent (H1 reserved)
    externalRef: text("external_ref"), // wa id, thread id
    connectorId: text("connector_id"), // orbit_channel_connectors.id (null for internally-raised conversations)
    doId: text("do_id"), // UserChannel Durable Object
    state: text("state").notNull().default("bot"), // bot|human|closed
    assigneeRef: text("assignee_ref"),
    teamId: text("team_id"),
    csat: integer("csat"),
    summary: text("summary"),
    lang: text("lang").notNull().default("en"),
    intent: text("intent"),
    sentiment: integer("sentiment"), // -100..100
    firstResponseMs: integer("first_response_ms"),
    lastMessageAt: integer("last_message_at"),
    closedAt: integer("closed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("orbit_conv_tenant_idx").on(t.tenantId, t.state, t.lastMessageAt),
    index("orbit_conv_customer_idx").on(t.tenantId, t.customerId),
    index("orbit_conv_assignee_idx").on(t.tenantId, t.assigneeRef, t.state)
  ]
);

export const messages = sqliteTable(
  "orbit_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(), // customer|agent_ai|agent_human|system
    modality: text("modality").notNull().default("text"), // text|voice|image|doc (reserved)
    content: text("content").notNull(),
    attachmentsJson: text("attachments_json"),
    redactionsJson: text("redactions_json"),
    aiAuditId: text("ai_audit_id"), // links a drafted/sent AI turn to its audit row
    deliveryStatus: text("delivery_status"), // queued|sent|delivered|read|failed
    externalRef: text("external_ref"),
    ts: integer("ts").notNull()
  },
  (t) => [
    index("orbit_messages_conv_idx").on(t.tenantId, t.conversationId, t.ts),
    uniqueIndex("orbit_messages_ext_uq").on(t.tenantId, t.externalRef)
  ]
);

export const channelConnectors = sqliteTable(
  "orbit_channel_connectors",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    provider: text("provider").notNull(), // whatsapp-cloud-api|mailgun-email
    transport: text("transport").notNull(), // whatsapp|email|web|voice|agent
    label: text("label").notNull(),
    secretsJson: text("secrets_json").notNull(), // sealed via packages/core field-crypto (beforeWrite)
    configJson: text("config_json").notNull().default("{}"),
    status: text("status").notNull().default("active"), // active|disabled
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("orbit_channel_connectors_tenant_idx").on(t.tenantId)]
);

export const channelIdentities = sqliteTable(
  "orbit_channel_identities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    connectorId: text("connector_id").notNull(),
    handle: text("handle").notNull(), // provider-side address: wa id, email
    customerId: text("customer_id").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    uniqueIndex("orbit_channel_identities_handle_uq").on(t.tenantId, t.connectorId, t.handle),
    index("orbit_channel_identities_customer_idx").on(t.customerId)
  ]
);

export const renewals = sqliteTable(
  "orbit_renewals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    policyRef: text("policy_ref").notNull(),
    customerId: text("customer_id").notNull(),
    expiryAt: integer("expiry_at").notNull(),
    churnScore: integer("churn_score"), // 0-100
    strategy: text("strategy").notNull().default("human"), // auto_requote|human|do_not_contact
    requotesJson: text("requotes_json"),
    state: text("state").notNull().default("scheduled"), // scheduled|offered|accepted|lost
    outcomeReason: text("outcome_reason"),
    ownerRef: text("owner_ref"),
    offeredAt: integer("offered_at"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("orbit_renewals_tenant_idx").on(t.tenantId, t.state, t.expiryAt),
    // Unique per term (policy + expiry), not per policy: a policy renews every
    // term and each term gets its own renewal row.
    uniqueIndex("orbit_renewals_policy_term_uq").on(t.tenantId, t.policyRef, t.expiryAt)
  ]
);

export const journeys = sqliteTable(
  "orbit_journeys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    nameJson: text("name_json").notNull(),
    graphJson: text("graph_json").notNull(),
    status: text("status").notNull().default("draft"), // draft|active|paused|retired
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [uniqueIndex("orbit_journeys_uq").on(t.tenantId, t.key, t.version)]
);

/** A customer's position in a journey graph. */
export const journeyRuns = sqliteTable(
  "orbit_journey_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    journeyId: text("journey_id").notNull(),
    customerId: text("customer_id").notNull(),
    node: text("node").notNull(),
    state: text("state").notNull().default("running"), // running|waiting|done|halted
    contextJson: text("context_json"),
    nextAt: integer("next_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("orbit_journey_runs_due_idx").on(t.tenantId, t.state, t.nextAt),
    uniqueIndex("orbit_journey_runs_uq").on(t.tenantId, t.journeyId, t.customerId)
  ]
);

/**
 * A distribution partner. `status` is whether we are trading with them today;
 * `stage` is where they are in getting there. The two are separate because a
 * live partner can be paused for a billing dispute without losing the record
 * that their diligence and agreement are done — pausing must not mean
 * re-onboarding.
 *
 * The stage ladder is walked by the onboarding engine, never set by hand:
 * `prospect > applied > screening > diligence > agreement > integration >
 * sandbox > live`, with `suspended` and `terminated` reachable from any stage.
 */
export const partners = sqliteTable(
  "orbit_partners",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // telco|auto|superapp|bank
    apiKeyRef: text("api_key_ref"),
    revshareJson: text("revshare_json"),
    sandboxFlag: integer("sandbox_flag", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("active"),
    contactJson: text("contact_json"),
    /** Where they are in onboarding. Advanced only by the engine. */
    stage: text("stage").notNull().default("prospect"),
    /** Who inside the tenant owns this relationship. */
    ownerRef: text("owner_ref"),
    /** Legal identity, so a payout is made to a named entity and not a nickname. */
    legalName: text("legal_name"),
    registrationNo: text("registration_no"),
    taxId: text("tax_id"),
    country: text("country"),
    /** Latest diligence: what was checked, by whom, and what came back. */
    screeningId: text("screening_id"), // -> compliance_screenings.id
    riskRating: text("risk_rating"), // low|medium|high
    /** The agreement version currently governing. */
    agreementId: text("agreement_id"), // -> dist_partner_agreements.id
    /** Bank details are a reference into the payout provider, never held here. */
    payoutMethodRef: text("payout_method_ref"),
    goLiveAt: integer("go_live_at"),
    suspendedAt: integer("suspended_at"),
    suspendedReason: text("suspended_reason"),
    terminatedAt: integer("terminated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("orbit_partners_tenant_idx").on(t.tenantId, t.status),
    index("orbit_partners_stage_idx").on(t.tenantId, t.stage),
    index("orbit_partners_owner_idx").on(t.tenantId, t.ownerRef)
  ]
);

export const partnerTxns = sqliteTable(
  "orbit_partner_txns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    partnerId: text("partner_id").notNull(),
    kind: text("kind").notNull(), // quote|bind|refund
    payloadHash: text("payload_hash").notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull(),
    revshareCalcMinor: integer("revshare_calc_minor").notNull().default(0),
    settlementBatch: text("settlement_batch"),
    txnRef: text("txn_ref"), // -> ledger txn
    ts: integer("ts").notNull()
  },
  (t) => [
    index("orbit_partner_txns_idx").on(t.tenantId, t.partnerId, t.ts),
    index("orbit_partner_txns_batch_idx").on(t.tenantId, t.settlementBatch)
  ]
);

export const handoverNotes = sqliteTable(
  "orbit_handover_notes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref"),
    summary: text("summary").notNull(),
    factsJson: text("facts_json"),
    generatedBy: text("generated_by").notNull().default("ai"), // ai|human
    acceptedBy: text("accepted_by"),
    ts: integer("ts").notNull()
  },
  (t) => [index("orbit_handover_idx").on(t.tenantId, t.conversationId, t.ts)]
);

export const qaScores = sqliteTable(
  "orbit_qa_scores",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    rubricKey: text("rubric_key").notNull(),
    score: integer("score").notNull(), // 0-100
    breakdownJson: text("breakdown_json"),
    flagsJson: text("flags_json"),
    scoredBy: text("scored_by").notNull(), // actor ref: user:<id> | agent:<key>
    disputedBy: text("disputed_by"),
    ts: integer("ts").notNull()
  },
  (t) => [index("orbit_qa_idx").on(t.tenantId, t.conversationId, t.ts)]
);
