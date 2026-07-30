import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// docs/03 §SIGNAL — marketing. Autonomy actions here are ledgered and undoable (docs/15 §4).

export const audiences = sqliteTable(
  "signal_audiences",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    definitionJson: text("definition_json").notNull(), // rule tree over the spine, consent-aware
    sizeCached: integer("size_cached"),
    refreshPolicy: text("refresh_policy").notNull().default("daily"), // manual|hourly|daily
    lastRefreshedAt: integer("last_refreshed_at"),
    consentPurposes: text("consent_purposes").notNull().default("marketing"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("signal_audiences_tenant_idx").on(t.tenantId, t.name)]
);

export const campaigns = sqliteTable(
  "signal_campaigns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    objective: text("objective").notNull(), // acq|renewal|xsell
    audienceId: text("audience_id"),
    channelsJson: text("channels_json").notNull(),
    budgetJson: text("budget_json").notNull(),
    state: text("state").notNull().default("draft"), // draft|review|scheduled|live|paused|ended
    guardrailChecksJson: text("guardrail_checks_json"),
    autonomyLevel: text("autonomy_level").notNull().default("act_with_approval"),
    startAt: integer("start_at"),
    endAt: integer("end_at"),
    ownerRef: text("owner_ref").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at")
  },
  (t) => [
    index("signal_campaigns_tenant_idx").on(t.tenantId, t.state, t.startAt),
    index("signal_campaigns_owner_idx").on(t.tenantId, t.ownerRef)
  ]
);

export const creatives = sqliteTable(
  "signal_creatives",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id"),
    kind: text("kind").notNull(), // ad|lp|email|social|video_script
    locale: text("locale").notNull().default("en"),
    contentRef: text("content_ref").notNull(), // R2 key or inline file id
    variantGroup: text("variant_group"),
    complianceStatus: text("compliance_status").notNull().default("pending"), // pending|passed|flagged|blocked
    complianceNotesJson: text("compliance_notes_json"),
    performanceJson: text("performance_json"),
    generatedBy: text("generated_by").notNull().default("human"), // human|ai
    aiAuditId: text("ai_audit_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("signal_creatives_tenant_idx").on(t.tenantId, t.campaignId, t.locale),
    index("signal_creatives_compliance_idx").on(t.tenantId, t.complianceStatus)
  ]
);

export const experiments = sqliteTable(
  "signal_experiments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id"),
    hypothesis: text("hypothesis").notNull(),
    variantsJson: text("variants_json").notNull(),
    metric: text("metric").notNull(),
    minSample: integer("min_sample"),
    state: text("state").notNull().default("draft"), // draft|running|concluded|abandoned
    resultJson: text("result_json"),
    concludedAt: integer("concluded_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("signal_experiments_tenant_idx").on(t.tenantId, t.state)]
);

/** The autopilot ledger. Every automated move is a row, reversible for 7 days. */
export const budgetMoves = sqliteTable(
  "signal_budget_moves",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    evidenceJson: text("evidence_json"),
    approvedBy: text("approved_by").notNull(), // auto|user:<id>
    reversedBy: text("reversed_by"),
    reversedAt: integer("reversed_at"),
    reversibleUntil: integer("reversible_until").notNull(),
    ts: integer("ts").notNull()
  },
  (t) => [index("signal_budget_moves_idx").on(t.tenantId, t.ts)]
);

export const aeoPages = sqliteTable(
  "signal_aeo_pages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    queryCluster: text("query_cluster").notNull(),
    locale: text("locale").notNull().default("en"),
    contentRef: text("content_ref").notNull(),
    citationsCheckJson: text("citations_check_json"),
    freshness: integer("freshness"), // last verified ts
    citedByJson: text("cited_by_json"), // which answer engines cite it
    status: text("status").notNull().default("draft"), // draft|published|stale|retired
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("signal_aeo_tenant_idx").on(t.tenantId, t.queryCluster, t.locale)]
);

export const attributionEvents = sqliteTable(
  "signal_attribution_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id"),
    anonId: text("anon_id"),
    touchType: text("touch_type").notNull(), // impression|click|visit|lead|bind
    channel: text("channel").notNull(),
    campaignId: text("campaign_id"),
    creativeId: text("creative_id"),
    valueMinor: integer("value_minor"),
    currency: text("currency"),
    subjectRef: text("subject_ref"), // the bind/case it resolved to
    ts: integer("ts").notNull()
  },
  (t) => [
    index("signal_attr_tenant_idx").on(t.tenantId, t.ts),
    index("signal_attr_customer_idx").on(t.tenantId, t.customerId, t.ts),
    index("signal_attr_campaign_idx").on(t.tenantId, t.campaignId, t.ts)
  ]
);

/** Spend actuals per channel/day — feeds CAC and the budget morning view (J-M2). */
export const spend = sqliteTable(
  "signal_spend",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id"),
    channel: text("channel").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    source: text("source").notNull().default("manual"), // manual|api|import
    ts: integer("ts").notNull()
  },
  (t) => [uniqueIndex("signal_spend_uq").on(t.tenantId, t.campaignId, t.channel, t.day)]
);
