import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// docs/03 §SCOUT — product intelligence. Signals in, whitespace out.

export const signals = sqliteTable(
  "scout_signals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    source: text("source").notNull(), // search|quotes|abandonment|reviews|news|regulatory
    sourceRef: text("source_ref"),
    payloadJson: text("payload_json").notNull(),
    embeddingRef: text("embedding_ref"), // Vectorize / qdrant id
    clusterId: text("cluster_id"),
    weight: integer("weight").notNull().default(1),
    observedAt: integer("observed_at").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    index("scout_signals_tenant_idx").on(t.tenantId, t.source, t.observedAt),
    index("scout_signals_cluster_idx").on(t.tenantId, t.clusterId)
  ]
);

export const clusters = sqliteTable(
  "scout_clusters",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    theme: text("theme").notNull(),
    summary: text("summary"),
    momentumScore: integer("momentum_score").notNull().default(0), // 0-100
    size: integer("size").notNull().default(0),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
    trailJson: text("trail_json"), // momentum trail points for the radar quadrant
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("scout_clusters_tenant_idx").on(t.tenantId, t.momentumScore)]
);

export const whitespaces = sqliteTable(
  "scout_whitespaces",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    description: text("description").notNull(),
    // Grouping key computeWhitespaceCandidates flagged this row for — same
    // role core_products.line plays on scout_panel_bench, kept as a real
    // column rather than parsed back out of `description`.
    category: text("category"),
    clusterId: text("cluster_id"),
    evidenceRefsJson: text("evidence_refs_json"),
    demandEstimate: integer("demand_estimate"),
    competitionScore: integer("competition_score"), // 0-100
    status: text("status").notNull().default("candidate"), // candidate|validating|validated|parked
    owner: text("owner"),
    promotedAt: integer("promoted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("scout_whitespaces_tenant_idx").on(t.tenantId, t.status, t.demandEstimate)]
);

export const panelBench = sqliteTable(
  "scout_panel_bench",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    providerId: text("provider_id").notNull(),
    line: text("line").notNull(),
    period: text("period").notNull(), // YYYY-MM
    ourPriceIdx: integer("our_price_idx"), // basis points vs market = 10000
    marketPriceIdx: integer("market_price_idx"),
    winRate: integer("win_rate"), // 0-100
    volume: integer("volume").notNull().default(0),
    coverageGapsJson: text("coverage_gaps_json"),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("scout_bench_tenant_idx").on(t.tenantId, t.period, t.providerId)]
);

export const experiments = sqliteTable(
  "scout_experiments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    whitespaceId: text("whitespace_id").notNull(),
    landingRef: text("landing_ref"),
    trafficPlanJson: text("traffic_plan_json"),
    resultsJson: text("results_json"),
    state: text("state").notNull().default("draft"), // draft|running|concluded|abandoned
    startedAt: integer("started_at"),
    concludedAt: integer("concluded_at"),
    createdAt: integer("created_at").notNull()
  },
  (t) => [index("scout_experiments_tenant_idx").on(t.tenantId, t.state)]
);

/** Packaged insight products sold to providers. Consent basis is mandatory. */
export const dataProducts = sqliteTable(
  "scout_data_products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    definitionJson: text("definition_json").notNull(),
    consentBasis: text("consent_basis").notNull(),
    aggregationMin: integer("aggregation_min").notNull().default(50), // k-anonymity floor
    subscribersJson: text("subscribers_json"),
    delivery: text("delivery").notNull().default("report"), // api|report
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [index("scout_data_products_tenant_idx").on(t.tenantId, t.status)]
);
