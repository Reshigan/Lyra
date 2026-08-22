import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// AI is a first-class subsystem, not a feature bolted to one module.
// ai_audit_log (core.ts) is the immutable spine; these tables are the operating
// surface: agents, runs, tool calls, approvals, evals, budgets, knowledge.

/** A registered agent: a named capability with an autonomy envelope. */
export const agents = sqliteTable(
  "ai_agents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(), // quoting|renewal|copilot|briefing|creative|recon|qa
    module: text("module").notNull(),
    nameJson: text("name_json").notNull(),
    descriptionJson: text("description_json"),
    autonomyLevel: text("autonomy_level").notNull().default("act_with_approval"),
    tier: text("tier").notNull().default("standard"), // fast|standard|reasoning
    toolsJson: text("tools_json"), // allowlisted tool names
    guardrailsJson: text("guardrails_json"),
    promptRef: text("prompt_ref"),
    status: text("status").notNull().default("active"), // active|paused|retired
    pausedBy: text("paused_by"),
    pausedReason: text("paused_reason"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("ai_agents_uq").on(t.tenantId, t.key)]
);

/** Versioned prompts. Never inline a prompt in app code — reference a row. */
export const prompts = sqliteTable(
  "ai_prompts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    locale: text("locale").notNull().default("en"),
    body: text("body").notNull(),
    variablesJson: text("variables_json"),
    status: text("status").notNull().default("draft"), // draft|active|retired
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (t) => [uniqueIndex("ai_prompts_uq").on(t.tenantId, t.key, t.version, t.locale)]
);

/** One agent invocation: many model calls, many tool calls, one outcome. */
export const runs = sqliteTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    agentKey: text("agent_key").notNull(),
    module: text("module").notNull(),
    purpose: text("purpose").notNull(),
    subjectRef: text("subject_ref"),
    actorRef: text("actor_ref").notNull(),
    autonomyLevel: text("autonomy_level").notNull(),
    trigger: text("trigger").notNull().default("user"), // user|event|schedule|api
    state: text("state").notNull().default("running"),
    // running|awaiting_approval|succeeded|refused|failed|cancelled|budget_stopped
    inputHash: text("input_hash").notNull(),
    outputRef: text("output_ref"),
    confidence: integer("confidence"), // 0-100, surfaced by ConfidenceMeter
    evidenceJson: text("evidence_json"), // EvidenceLink targets
    reasoningRef: text("reasoning_ref"), // R2 key, retained for explainability
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costMicro: integer("cost_micro").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    approvalId: text("approval_id"),
    errorCode: text("error_code"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at")
  },
  (t) => [
    index("ai_runs_tenant_idx").on(t.tenantId, t.state, t.startedAt),
    index("ai_runs_agent_idx").on(t.tenantId, t.agentKey, t.startedAt),
    index("ai_runs_subject_idx").on(t.tenantId, t.subjectRef)
  ]
);

/** Every tool the agent reached for, with the result hash. Consequential
 *  tools carry an approval id — no side effect without one (CLAUDE.md rule 4). */
export const toolCalls = sqliteTable(
  "ai_tool_calls",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    tool: text("tool").notNull(),
    argsHash: text("args_hash").notNull(),
    argsRedactedJson: text("args_redacted_json"),
    consequential: integer("consequential", { mode: "boolean" }).notNull().default(false),
    approvalId: text("approval_id"),
    outcome: text("outcome").notNull().default("ok"), // ok|error|blocked|awaiting_approval
    resultHash: text("result_hash"),
    durationMs: integer("duration_ms"),
    ts: integer("ts").notNull()
  },
  (t) => [uniqueIndex("ai_tool_calls_uq").on(t.tenantId, t.runId, t.seq)]
);

/** Suggestions the user accepted, edited or dismissed — the feedback loop that
 *  makes the ambient grammar earn its presence (docs/15 §4). */
export const suggestions = sqliteTable(
  "ai_suggestions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id"),
    surface: text("surface").notNull(), // ghost_text|chip|draft|forecast|filter
    module: text("module").notNull(),
    subjectRef: text("subject_ref"),
    userId: text("user_id").notNull(),
    contentRef: text("content_ref"),
    outcome: text("outcome").notNull().default("shown"), // shown|accepted|edited|dismissed|expired
    editDistance: integer("edit_distance"),
    shownAt: integer("shown_at").notNull(),
    resolvedAt: integer("resolved_at")
  },
  (t) => [
    index("ai_suggestions_idx").on(t.tenantId, t.surface, t.shownAt),
    index("ai_suggestions_user_idx").on(t.tenantId, t.userId, t.outcome)
  ]
);

/** Per-tenant-per-day budget state; the Durable Object is the fast path, this
 *  is the durable record and the source for the BudgetMeter. */
export const budgets = sqliteTable(
  "ai_budgets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD
    module: text("module").notNull().default("*"),
    tokensUsed: integer("tokens_used").notNull().default(0),
    costMicroUsed: integer("cost_micro_used").notNull().default(0),
    tokensLimit: integer("tokens_limit").notNull(),
    costMicroLimit: integer("cost_micro_limit").notNull(),
    thresholdNotifiedAt: integer("threshold_notified_at"),
    stoppedAt: integer("stopped_at"),
    updatedAt: integer("updated_at").notNull()
  },
  (t) => [uniqueIndex("ai_budgets_uq").on(t.tenantId, t.day, t.module)]
);

/** Eval suites run as tests (docs/13 EDD). Regressions block a release. */
export const evals = sqliteTable(
  "ai_evals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    suite: text("suite").notNull(),
    caseKey: text("case_key").notNull(),
    agentKey: text("agent_key").notNull(),
    model: text("model").notNull(),
    score: integer("score").notNull(), // 0-100
    passed: integer("passed", { mode: "boolean" }).notNull(),
    thresholdScore: integer("threshold_score").notNull(),
    detailJson: text("detail_json"),
    gitSha: text("git_sha"),
    ts: integer("ts").notNull()
  },
  (t) => [index("ai_evals_idx").on(t.tenantId, t.suite, t.ts)]
);

/** Retrieval corpus registry. Chunks live in Vectorize (cloud) / qdrant (on-prem);
 *  this row is the tenant-scoped, permissioned handle to them. */
export const knowledgeSources = sqliteTable(
  "ai_knowledge_sources",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // policy_wording|sop|faq|product|regulatory|web
    uri: text("uri"),
    fileId: text("file_id"),
    locale: text("locale").notNull().default("en"),
    piiLevel: text("pii_level").notNull().default("none"),
    chunkCount: integer("chunk_count").notNull().default(0),
    indexNamespace: text("index_namespace"),
    status: text("status").notNull().default("pending"), // pending|indexing|ready|failed|stale
    lastIndexedAt: integer("last_indexed_at"),
    createdAt: integer("created_at").notNull()
  },
  (t) => [index("ai_knowledge_idx").on(t.tenantId, t.kind, t.status)]
);

/** Guardrail trips: refusals, PII leaks caught, compliance blocks, jailbreaks. */
export const guardrailEvents = sqliteTable(
  "ai_guardrail_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id"),
    rule: text("rule").notNull(),
    severity: text("severity").notNull().default("warn"), // info|warn|block
    detail: text("detail"),
    subjectRef: text("subject_ref"),
    ts: integer("ts").notNull()
  },
  (t) => [index("ai_guardrail_idx").on(t.tenantId, t.severity, t.ts)]
);

/** ADR-0073. An action the command loop wants taken, held for a human. The
 *  loop never executes a consequential tool: it writes one of these and the
 *  model sees `proposed:<id>` back. Execution happens only through the
 *  module's real action path, so the approval gate fires exactly once for an
 *  agent-raised and a desk-raised change alike (CLAUDE.md rule 4). */
export const commandProposals = sqliteTable(
  "ai_command_proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    module: text("module").notNull(),
    toolName: text("tool_name").notNull(),
    subjectRef: text("subject_ref"),
    /** The approval policy this action gates under; null for a
     *  non-consequential proposal (envelope held a read back). */
    policyKey: text("policy_key"),
    argsJson: text("args_json").notNull(),
    /** The inspectable "why" (docs/15): the run's reasoning for this action. */
    whyJson: text("why_json"),
    state: text("state").notNull().default("proposed"), // proposed|actioned|dismissed|expired
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    approvalId: text("approval_id"),
    createdAt: integer("created_at").notNull()
  },
  (t) => [
    index("ai_command_proposals_idx").on(t.tenantId, t.state, t.createdAt),
    index("ai_command_proposals_run_idx").on(t.tenantId, t.runId)
  ]
);
