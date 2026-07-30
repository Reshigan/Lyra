import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// Enterprise reporting: definitions live in the semantic layer (north_metrics),
// reports compose them, runs materialise them, exports render XLSX/PDF/CSV to R2,
// schedules deliver them. Every export is permission- and PII-checked and audited.

export const dashboards = sqliteTable(
  "analytics_dashboards",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    module: text("module").notNull(), // axis|orbit|signal|scout|north|core
    nameJson: text("name_json").notNull(),
    layoutJson: text("layout_json").notNull(), // tiles: metric key, viz, filters, span
    scope: text("scope").notNull().default("tenant"), // tenant|team|personal
    ownerRef: text("owner_ref"),
    rolesJson: text("roles_json"), // visible to these role keys
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("analytics_dashboards_uq").on(t.tenantId, t.key, t.scope, t.ownerRef)]
);

/** A report is a saved query over the semantic layer — never raw SQL from a user. */
export const reports = sqliteTable(
  "analytics_reports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    module: text("module").notNull(),
    nameJson: text("name_json").notNull(),
    descriptionJson: text("description_json"),
    definitionJson: text("definition_json").notNull(),
    // {metrics[], dimensions[], filters[], grain, sort, limit, columns[]}
    piiLevel: text("pii_level").notNull().default("none"), // none|low|high
    requiredPermission: text("required_permission").notNull(),
    ownerRef: text("owner_ref"),
    scope: text("scope").notNull().default("tenant"), // tenant|team|personal
    system: integer("system", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at")
  },
  (t) => [
    index("analytics_reports_module_idx").on(t.tenantId, t.module),
    uniqueIndex("analytics_reports_uq").on(t.tenantId, t.key, t.scope, t.ownerRef)
  ]
);

/** One materialisation. Big runs stream to R2 rather than into the response. */
export const reportRuns = sqliteTable(
  "analytics_report_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reportId: text("report_id").notNull(),
    paramsJson: text("params_json"),
    requestedBy: text("requested_by").notNull(),
    trigger: text("trigger").notNull().default("user"), // user|schedule|api
    state: text("state").notNull().default("queued"), // queued|running|done|failed|expired
    rowCount: integer("row_count"),
    resultRef: text("result_ref"), // R2 key of the materialised rows
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    durationMs: integer("duration_ms"),
    error: text("error"),
    expiresAt: integer("expires_at"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at")
  },
  (t) => [index("analytics_report_runs_idx").on(t.tenantId, t.reportId, t.startedAt)]
);

/** The artefact. XLSX and PDF are first-class, not an afterthought. */
export const exports = sqliteTable(
  "analytics_exports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id"),
    reportId: text("report_id"),
    subjectRef: text("subject_ref"), // for non-report exports (case pack, boardpack)
    format: text("format").notNull(), // xlsx|pdf|csv|json
    fileId: text("file_id"),
    sizeBytes: integer("size_bytes"),
    rowCount: integer("row_count"),
    piiMasked: integer("pii_masked", { mode: "boolean" }).notNull().default(true),
    piiJustification: text("pii_justification"),
    watermark: text("watermark"), // recipient + timestamp burned into PDF
    requestedBy: text("requested_by").notNull(),
    approvedBy: text("approved_by"), // required when piiMasked = false
    state: text("state").notNull().default("queued"), // queued|rendering|ready|failed|expired
    downloadCount: integer("download_count").notNull().default(0),
    expiresAt: integer("expires_at"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [
    index("analytics_exports_idx").on(t.tenantId, t.state, t.createdAt),
    index("analytics_exports_requester_idx").on(t.tenantId, t.requestedBy, t.createdAt)
  ]
);

/** Scheduled delivery: the 7am read, the Monday pack, the month-end recon file. */
export const schedules = sqliteTable(
  "analytics_schedules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reportId: text("report_id"),
    dashboardId: text("dashboard_id"),
    nameJson: text("name_json").notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("Asia/Dubai"),
    format: text("format").notNull().default("pdf"),
    recipientsJson: text("recipients_json").notNull(), // user ids / emails, consent-checked
    paramsJson: text("params_json"),
    locale: text("locale").notNull().default("en"),
    status: text("status").notNull().default("active"), // active|paused
    lastRunAt: integer("last_run_at"),
    lastState: text("last_state"),
    nextRunAt: integer("next_run_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("analytics_schedules_due_idx").on(t.tenantId, t.status, t.nextRunAt)]
);

/** Saved views on every list surface (docs/07): filters, columns, sort, density. */
export const savedViews = sqliteTable(
  "analytics_saved_views",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id"), // null = shared with the tenant
    route: text("route").notNull(),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    columnsJson: text("columns_json"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sharedWithJson: text("shared_with_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("analytics_saved_views_idx").on(t.tenantId, t.route, t.userId)]
);

/** Facts for cost-per-outcome telemetry (NFR-013): cost per case, per
 *  conversation, per brief. Rolled nightly from ai_runs + ledger 5100/5200. */
export const unitEconomics = sqliteTable(
  "analytics_unit_economics",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    day: text("day").notNull(),
    module: text("module").notNull(),
    unit: text("unit").notNull(), // case|conversation|renewal|brief|campaign|bind
    volume: integer("volume").notNull().default(0),
    aiCostMicro: integer("ai_cost_micro").notNull().default(0),
    mediaCostMicro: integer("media_cost_micro").notNull().default(0),
    humanMinutes: integer("human_minutes").notNull().default(0),
    revenueMinor: integer("revenue_minor").notNull().default(0),
    currency: text("currency").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("analytics_unit_econ_uq").on(t.tenantId, t.day, t.module, t.unit)]
);

/** Product telemetry for journeys (J-IDs) — completion, drop-off, time-to-value. */
export const journeyEvents = sqliteTable(
  "analytics_journey_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    journeyId: text("journey_id").notNull(), // "J-C1", "J-M2" ...
    step: text("step").notNull(),
    actorRef: text("actor_ref").notNull(),
    subjectRef: text("subject_ref"),
    outcome: text("outcome").notNull().default("progressed"), // progressed|completed|abandoned|failed
    durationMs: integer("duration_ms"),
    ts: integer("ts").notNull()
  },
  (t) => [index("analytics_journey_events_idx").on(t.tenantId, t.journeyId, t.ts)]
);
