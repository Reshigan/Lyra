import { schema } from "@lyra/db";
import { CUSTOMER_PII } from "@lyra/core";
import { register, type Resource } from "./crud.js";
import {
  dashboardVisible,
  exportVisible,
  reportRunVisible,
  reportVisible,
  savedViewVisible
} from "./routes/analytics.js";

// Every table the API exposes as CRUD, in one list. A table that is missing here
// has no HTTP surface at all, which is the intended default for anything the
// platform writes and nobody edits (audit rows, outbox, idempotency keys).
//
// Read the columns as: path, table, id prefix, module, permissions. Anything a
// resource needs beyond CRUD lives in its module router (routes/*.ts).

const r = (
  path: string,
  table: Resource["table"],
  idPrefix: string,
  module: Resource["module"],
  perms: Resource["perms"],
  extra: Partial<Resource> = {}
): Resource => ({ path, table, idPrefix, module, perms, ...extra });

/** read/create/update/delete off one permission stem, the common case. */
const rcud = (stem: string) => ({
  read: `${stem}:read`,
  create: `${stem}:create`,
  update: `${stem}:update`,
  remove: `${stem}:delete`
});

/** read + a single write permission — the shape most config tables use. */
const rw = (stem: string) => ({
  read: `${stem}:read`,
  create: `${stem}:write`,
  update: `${stem}:write`,
  remove: `${stem}:write`
});

/** read + a single `:update` permission — for stems that never coined `:write`. */
const ru = (stem: string) => ({
  read: `${stem}:read`,
  create: `${stem}:update`,
  update: `${stem}:update`,
  remove: `${stem}:update`
});

const ro = (perm: string) => ({ read: perm });

/* -------------------------------------------------------------------- core */

export const CORE = register(
  r("tenants", schema.tenants, "tn", "core", {
    read: "core:tenants:read",
    update: "core:tenants:update"
  }),
  r("users", schema.users, "us", "core", rcud("core:users"), {
    searchable: ["name", "email"],
    pii: { email: "email", phone: "phone", name: "name" },
    // ...and never comes back out either. Refusing a credential in the body
    // while `GET /users/:id` returned it was half a defence: the hash is what an
    // offline cracker wants, and `mfa_secret` is the second factor itself —
    // anyone who read it could mint valid codes forever.
    secretColumns: ["passwordHash", "mfaSecret", "mfaRecoveryJson"],
    // A credential must never round-trip through a CRUD body — not the password
    // hash, not the TOTP secret, and not the recovery codes that bypass it.
    beforeWrite: (_ctx, values) => {
      const { passwordHash: _p, mfaSecret: _m, mfaRecoveryJson: _r, ...rest } = values;
      return rest;
    }
  }),
  r("roles", schema.roles, "rl", "core", {
    read: "core:roles:read",
    create: "core:roles:update",
    update: "core:roles:update",
    remove: "core:roles:update"
  }),
  r("user-roles", schema.userRoles, "ur", "core", {
    read: "core:roles:read",
    create: "core:roles:assign",
    remove: "core:roles:assign"
  }),
  r("teams", schema.teams, "tm", "core", rw("core:teams"), { searchable: ["name"] }),
  r("customers", schema.customers, "cu", "core", rcud("core:customers"), {
    searchable: ["nameJson", "emailsJson", "phonesJson"],
    pii: CUSTOMER_PII
  }),
  // Consent is evidence. It can be granted and withdrawn, never edited.
  r("consents", schema.consents, "cs", "core", {
    read: "core:consents:read",
    create: "core:consents:create"
  }, { immutable: true }),
  r("products", schema.products, "prd", "core", rw("core:products"), { searchable: ["name", "code"] }),
  r("providers", schema.providers, "prv", "core", rw("core:providers"), { searchable: ["name", "code"] }),
  r("files", schema.files, "fil", "core", {
    read: "core:files:read",
    create: "core:files:create",
    remove: "core:files:delete"
    // ponytail: no filename column exists — files are found by what they are
    // attached to. Add a `filename` column and put it here when someone needs
    // to search by the name the browser uploaded.
  }, { searchable: ["subjectRef"] }),
  r("approvals", schema.approvals, "apr", "core", ro("core:approvals:read")),
  r("mandates", schema.mandates, "mnd", "core", ru("core:settings")),
  r("identity-verifications", schema.identityVerifications, "idv", "core", ro("core:customers:read")),
  r("memories", schema.memories, "mem", "core", ru("core:settings")),
  r("lenses", schema.lenses, "lns", "core", ru("core:settings")),
  r("rulepacks", schema.rulepacks, "rpk", "core", {
    read: "compliance:rulepacks:read",
    create: "compliance:rulepacks:apply",
    update: "compliance:rulepacks:apply"
  }),
  // No `create` here on purpose: minting a key generates a plaintext that is
  // shown once and never stored, so generated CRUD (which would want the client
  // to supply `prefix` and `keyHash`) cannot serve it. POST /v1/core/api-keys
  // lives in routes/core.ts; list and record still come from here.
  r("api-keys", schema.apiKeys, "key", "core", {
    read: "core:api_keys:read",
    remove: "core:api_keys:revoke"
  }, {
    // The hash is the whole verification test: `sha256(presented) === keyHash`.
    // Handing it out turns a read permission into an offline oracle for guessing
    // a live key. The plaintext is shown once at mint and nowhere else.
    secretColumns: ["keyHash"]
  }),
  // The client secret is never here: the row names a worker secret, it does not
  // hold one (routes/sso.ts).
  r("identity-providers", schema.identityProviders, "idp", "core", rw("core:identity_providers"), {
    searchable: ["name", "emailDomain"]
  }),
  // `secret` is the raw HMAC signing key, not a hash of one: whoever reads it
  // can forge a delivery the receiver will verify as ours. It is writable (a
  // tenant sets or rotates it) and never readable back.
  r("webhooks", schema.webhooks, "whk", "core", rw("core:webhooks"), { secretColumns: ["secret"] }),
  r("webhook-deliveries", schema.webhookDeliveries, "whd", "core", ro("core:webhooks:read")),
  r("notifications", schema.notifications, "ntf", "core", ro("core:notifications:read")),
  r("audit-log", schema.auditLog, "aud", "core", ro("core:audit:read"), { immutable: true }),
  r("event-dlq", schema.eventDlq, "dlq", "core", ro("admin:dlq:read"))
);

/* -------------------------------------------------------------------- dist */

export const DIST = register(
  r("channels", schema.distChannels, "chn", "dist", rw("dist:channels"), {
    searchable: ["name", "key"],
    approval: { create: "dist.partner_activate" }
  }),
  r("offerings", schema.distOfferings, "off", "dist", rw("dist:offerings"), {
    searchable: ["name", "code"],
    approval: { update: "dist.offering_publish" }
  }),
  // Rates are effective-dated evidence of what was agreed. Supersede, never edit.
  r("commission-rates", schema.distCommissionRates, "cr", "dist", {
    read: "dist:rates:read",
    create: "dist:rates:write"
  }, { immutable: true, actorColumns: ["createdBy"], approval: { create: "dist.rate_change" } }),
  r("quote-requests", schema.distQuoteRequests, "qr", "dist", {
    read: "dist:quote_requests:read",
    create: "dist:quote_requests:create",
    update: "dist:quote_requests:create"
  }),
  r("quote-responses", schema.distQuoteResponses, "qs", "dist", ro("dist:quote_requests:read")),
  r("commission-entries", schema.distCommissionEntries, "ce", "dist", {
    read: "dist:commissions:read",
    update: "dist:commissions:adjust"
  }, {
    // `netCommissionMinor` is the column; the old `netMinor` (a settlements
    // column) named nothing here, so the approval carried no amount at all.
    approval: { update: "dist.commission_adjust", amountField: "netCommissionMinor" }
  }),
  r("next-best-offers", schema.distNextBestOffers, "nb", "dist", {
    read: "dist:offers:read",
    update: "dist:offers:override"
  })
);

/* -------------------------------------------------------------------- axis */

export const AXIS = register(
  r("cases", schema.axisCases, "cas", "axis", rcud("axis:cases"), { searchable: ["ref"] }),
  r("quotes", schema.axisQuotes, "qt", "axis", {
    read: "axis:quotes:read",
    create: "axis:quotes:create",
    update: "axis:quotes:create"
  }),
  r("documents", schema.axisDocuments, "doc", "axis", {
    read: "axis:documents:read",
    create: "axis:documents:upload",
    update: "axis:documents:verify"
  }),
  r("tasks", schema.axisTasks, "tsk", "axis", rw("axis:tasks"), { actorColumns: ["createdBy"] }),
  r("case-approvals", schema.axisApprovals, "cap", "axis", ro("axis:cases:approve")),
  r("policies", schema.axisPolicies, "pol", "axis", {
    read: "axis:policies:read",
    create: "axis:policies:create",
    update: "axis:policies:update"
  }, { approval: { create: "axis.bind", amountField: "premiumMinor" } }),
  r("escrow-batches", schema.axisEscrowBatches, "esc", "axis", {
    read: "axis:escrow:read",
    update: "axis:escrow:reconcile"
  }, {
    // The batch has no `amountMinor`; what is released is what was received,
    // so the reviewer sees `receivedMinor` rather than nothing.
    approval: { update: "axis.escrow_release", amountField: "receivedMinor" }
  }),
  r("sops", schema.axisSops, "sop", "axis", rw("axis:sops"), { actorColumns: ["createdBy"] }),
  r("process-events", schema.axisProcessEvents, "pev", "axis", ro("axis:metrics:read"), { immutable: true }),
  r("claims", schema.axisClaims, "clm", "axis", {
    read: "axis:claims:read",
    create: "axis:claims:create",
    update: "axis:claims:update"
  }, { approval: { update: "axis.claim_settlement", amountField: "settledMinor" } })
);

/* ------------------------------------------------------------------- orbit */

export const ORBIT = register(
  r("conversations", schema.orbitConversations, "cnv", "orbit", {
    read: "orbit:conversations:read",
    create: "orbit:conversations:reply",
    update: "orbit:conversations:assign"
  }),
  r("messages", schema.orbitMessages, "msg", "orbit", {
    read: "orbit:messages:read",
    create: "orbit:messages:send"
    // The column is `content`; `body` named nothing, so every message body was
    // readable without `core:pii:view` — a masking rule that masked no column.
  }, { immutable: true, pii: { content: "text" } }),
  r("renewals", schema.orbitRenewals, "rnw", "orbit", {
    read: "orbit:renewals:read",
    update: "orbit:renewals:update"
  }),
  r("journeys", schema.orbitJourneys, "jrn", "orbit", rw("orbit:journeys"), { actorColumns: ["createdBy"] }),
  r("journey-runs", schema.orbitJourneyRuns, "jrr", "orbit", ro("orbit:journeys:read")),
  r("partners", schema.orbitPartners, "ptn", "orbit", {
    read: "orbit:partners:read",
    create: "orbit:partners:create",
    update: "orbit:partners:update"
  }, { searchable: ["name"], approval: { create: "dist.partner_activate" } }),
  r("partner-txns", schema.orbitPartnerTxns, "ptx", "orbit", ro("orbit:partners:read")),
  r("handover-notes", schema.orbitHandoverNotes, "hnd", "orbit", rw("orbit:handover")),
  r("qa-scores", schema.orbitQaScores, "qas", "orbit", {
    read: "orbit:qa:read",
    create: "orbit:qa:score"
  }, { actorColumns: ["scoredBy"] })
);

/* ------------------------------------------------------------------ signal */

export const SIGNAL = register(
  r("audiences", schema.signalAudiences, "aud", "signal", {
    read: "signal:audiences:read",
    create: "signal:audiences:create",
    update: "signal:audiences:create"
  }, { actorColumns: ["createdBy"] }),
  r("campaigns", schema.signalCampaigns, "cmp", "signal", {
    read: "signal:campaigns:read",
    create: "signal:campaigns:create",
    update: "signal:campaigns:update"
  }, {
    searchable: ["name"],
    // No amountField: a campaign's budget lives in `budgetJson` (per channel,
    // per period), not in a scalar column, and `amountField` reads one column.
    // The launch approval shows the campaign, not a number.
    approval: { update: "signal.campaign_launch" }
  }),
  r("creatives", schema.signalCreatives, "crv", "signal", {
    read: "signal:creatives:read",
    create: "signal:creatives:generate",
    update: "signal:creatives:approve"
  }, { approval: { update: "signal.creative_publish" } }),
  r("signal-experiments", schema.signalExperiments, "exp", "signal", {
    read: "signal:experiments:read",
    create: "signal:experiments:create",
    update: "signal:experiments:decide"
  }),
  r("budget-moves", schema.signalBudgetMoves, "bmv", "signal", {
    read: "signal:budget_moves:read",
    update: "signal:budget_moves:approve"
  }, { approval: { update: "signal.budget_move", amountField: "amountMinor" } }),
  r("aeo-pages", schema.signalAeoPages, "aeo", "signal", rw("signal:aeo")),
  r("attribution-events", schema.signalAttributionEvents, "atr", "signal", ro("signal:attribution:read"), {
    immutable: true
  }),
  r("spend", schema.signalSpend, "spd", "signal", ro("signal:spend:read"))
);

/* ------------------------------------------------------------------- scout */

export const SCOUT = register(
  r("signals", schema.scoutSignals, "sig", "scout", {
    read: "scout:signals:read",
    create: "scout:signals:ingest"
  }),
  r("clusters", schema.scoutClusters, "clu", "scout", ro("scout:clusters:read")),
  r("whitespaces", schema.scoutWhitespaces, "wsp", "scout", {
    read: "scout:whitespaces:read",
    update: "scout:whitespaces:promote"
  }),
  r("panel-bench", schema.scoutPanelBench, "pnb", "scout", ro("scout:panel_bench:read")),
  r("scout-experiments", schema.scoutExperiments, "sxp", "scout", {
    read: "scout:experiments:read",
    create: "scout:experiments:create",
    update: "scout:experiments:decide"
  }),
  r("data-products", schema.scoutDataProducts, "dtp", "scout", {
    read: "scout:data_products:read",
    create: "scout:data_products:create",
    update: "scout:data_products:publish"
  })
);

/* ------------------------------------------------------------------- north */

export const NORTH = register(
  r("metrics", schema.northMetrics, "mtr", "north", rw("north:metrics")),
  r("snapshots", schema.northSnapshots, "snp", "north", ro("north:snapshots:read"), { immutable: true }),
  r("briefings", schema.northBriefings, "brf", "north", {
    read: "north:briefings:read",
    create: "north:briefings:generate",
    update: "north:briefings:approve"
  }),
  r("anomalies", schema.northAnomalies, "ano", "north", {
    read: "north:anomalies:read",
    update: "north:anomalies:assign"
  }),
  r("scenarios", schema.northScenarios, "scn", "north", {
    read: "north:scenarios:read",
    create: "north:scenarios:run",
    update: "north:scenarios:run"
  }),
  r("boardpacks", schema.northBoardpacks, "bpk", "north", {
    read: "north:boardpacks:read",
    create: "north:boardpacks:generate"
  }),
  r("decisions", schema.northDecisions, "dec", "north", rw("north:decisions"))
);

/* ------------------------------------------------------------------ ledger */

export const LEDGER = register(
  r("txns", schema.ledgerTxns, "txn", "ledger", {
    read: "ledger:txns:read",
    create: "ledger:txns:create"
  }),
  r("txn-transitions", schema.ledgerTxnTransitions, "txt", "ledger", ro("ledger:txns:read"), {
    immutable: true
  }),
  r("saga-steps", schema.ledgerSagaSteps, "sag", "ledger", ro("ledger:txns:read")),
  r("accounts", schema.ledgerAccounts, "acc", "ledger", rw("ledger:accounts")),
  // Posted journals are the record. They are reversed, never amended.
  r("journal-batches", schema.ledgerJournalBatches, "bat", "ledger", ro("ledger:journals:read"), {
    immutable: true
  }),
  r("journal-lines", schema.ledgerJournalLines, "jln", "ledger", ro("ledger:journals:read"), {
    immutable: true
  }),
  r("account-balances", schema.ledgerAccountBalances, "bal", "ledger", ro("ledger:accounts:read")),
  r("periods", schema.ledgerPeriods, "per", "ledger", {
    read: "ledger:periods:read",
    update: "ledger:periods:close"
  }, { approval: { update: "ledger.period_close" } }),
  r("recon-runs", schema.ledgerReconRuns, "rcr", "ledger", {
    read: "ledger:recon:read",
    create: "ledger:recon:run"
  }),
  r("recon-matches", schema.ledgerReconMatches, "rcm", "ledger", {
    read: "ledger:recon:read",
    update: "ledger:recon:confirm"
  }),
  r("client-money-checks", schema.ledgerClientMoneyChecks, "cmc", "ledger", ro("ledger:client_money:read"), {
    immutable: true
  }),
  r("subscriptions", schema.ledgerSubscriptions, "sub", "ledger", rw("admin:billing")),
  r("invoices", schema.ledgerInvoices, "inv", "ledger", {
    read: "ledger:invoices:read",
    create: "ledger:invoices:create",
    update: "ledger:invoices:approve"
  }),
  r("revenue-schedules", schema.ledgerRevenueSchedules, "rev", "ledger", ro("ledger:journals:read")),
  r("usage-meters", schema.ledgerUsageMeters, "usg", "ledger", ro("admin:billing:read")),
  r("payments", schema.ledgerPayments, "pay", "ledger", {
    read: "ledger:payments:read",
    create: "ledger:payments:create"
  }),
  r("payment-plans", schema.ledgerPaymentPlans, "ppl", "ledger", {
    read: "ledger:payments:read",
    create: "ledger:payments:create",
    update: "ledger:payments:create"
  }),
  r("fx-rates", schema.ledgerFxRates, "fx", "ledger", rw("ledger:accounts"), { immutable: true }),
  r("tax-rules", schema.ledgerTaxRules, "tax", "ledger", rw("ledger:accounts")),
  r("settlements", schema.ledgerSettlements, "stl", "ledger", {
    read: "dist:commissions:read",
    create: "dist:commissions:settle",
    update: "dist:commissions:settle"
  }, { approval: { create: "dist.settlement_run", amountField: "netMinor" } })
);

/* ---------------------------------------------------------------------- ai */

export const AI = register(
  r("agents", schema.aiAgents, "agt", "ai", rw("ai:agents")),
  r("prompts", schema.aiPrompts, "prm", "ai", rw("ai:prompts"), {
    actorColumns: ["createdBy"],
    approval: { update: "ai.prompt_publish" }
  }),
  r("runs", schema.aiRuns, "run", "ai", ro("ai:runs:read"), { immutable: true }),
  r("tool-calls", schema.aiToolCalls, "tlc", "ai", ro("ai:runs:read"), { immutable: true }),
  r("suggestions", schema.aiSuggestions, "sug", "ai", {
    read: "ai:suggestions:read",
    update: "ai:suggestions:read"
  }),
  r("budgets", schema.aiBudgets, "bdg", "ai", rw("ai:budgets"), {
    approval: { update: "ai.budget_raise" }
  }),
  r("evals", schema.aiEvals, "evl", "ai", {
    read: "ai:evals:read",
    create: "ai:evals:run"
  }),
  r("knowledge-sources", schema.aiKnowledgeSources, "kns", "ai", rw("ai:prompts")),
  r("guardrail-events", schema.aiGuardrailEvents, "gre", "ai", ro("ai:audit:read"), { immutable: true }),
  // Content is never stored, only hashes — so this is safe to expose to auditors.
  r("ai-audit-log", schema.aiAuditLog, "aia", "ai", ro("ai:audit:read"), { immutable: true })
);

/* -------------------------------------------------------------- compliance */

export const COMPLIANCE = register(
  r("dsar-requests", schema.dsarRequests, "dsr", "compliance", {
    read: "compliance:dsar:read",
    create: "compliance:dsar:create",
    update: "compliance:dsar:fulfil"
  }),
  r("erasure-log", schema.erasureLog, "ers", "compliance", ro("compliance:dsar:read"), { immutable: true }),
  r("disclosures", schema.disclosures, "dsc", "compliance", ro("compliance:disclosures:read"), {
    immutable: true
  }),
  // Read-only here: these three are produced by run/export endpoints in
  // routes/compliance.ts, which hash and gather server-side. A generated
  // `create` would let a caller post the hash it wants.
  r("screenings", schema.screenings, "scr", "compliance", ro("compliance:screenings:read")),
  r("retention-runs", schema.retentionRuns, "ret", "compliance", ro("compliance:retention:read")),
  r("legal-holds", schema.legalHolds, "lgh", "compliance", rw("compliance:legal_holds"), {
    actorColumns: ["placedBy"],
    approval: { remove: "compliance.legal_hold_release" }
  }),
  r("evidence-bundles", schema.evidenceBundles, "evb", "compliance", ro("compliance:evidence:read"), {
    immutable: true,
    actorColumns: ["requestedBy"]
  }),
  r("incidents", schema.incidents, "inc", "compliance", rw("compliance:incidents"), {
    actorColumns: ["openedBy"]
  }),
  r("rulepack-applications", schema.rulepackApplications, "rpa", "compliance", {
    read: "compliance:rulepacks:read",
    create: "compliance:rulepacks:apply"
  }),
  r("policy-thresholds", schema.policyThresholds, "pth", "compliance", rw("compliance:thresholds"), {
    actorColumns: ["setBy"]
  })
);

/* --------------------------------------------------------------- analytics */

export const ANALYTICS = register(
  // The row rules live beside the module routes that also enforce them, so a
  // record read through generic CRUD and the same record read through
  // /v1/analytics/* cannot disagree.
  r("dashboards", schema.dashboards, "dsh", "analytics", rw("analytics:dashboards"), {
    searchable: ["name"],
    rowVisible: dashboardVisible as NonNullable<Resource["rowVisible"]>
  }),
  r("reports", schema.reports, "rpt", "analytics", rw("analytics:reports"), {
    searchable: ["name"],
    rowVisible: reportVisible as NonNullable<Resource["rowVisible"]>
  }),
  r("report-runs", schema.reportRuns, "rrn", "analytics", {
    read: "analytics:reports:read",
    create: "analytics:reports:run"
  }, { actorColumns: ["requestedBy"], rowVisible: reportRunVisible as NonNullable<Resource["rowVisible"]> }),
  r("exports", schema.analyticsExports, "exp", "analytics", {
    read: "analytics:exports:download",
    create: "analytics:exports:create"
  }, {
    immutable: true,
    actorColumns: ["requestedBy"],
    rowVisible: exportVisible as NonNullable<Resource["rowVisible"]>
  }),
  r("schedules", schema.analyticsSchedules, "sch", "analytics", rw("analytics:schedules"), {
    actorColumns: ["createdBy"]
  }),
  r("saved-views", schema.savedViews, "svw", "analytics", rw("analytics:saved_views"), {
    rowVisible: savedViewVisible as NonNullable<Resource["rowVisible"]>
  }),
  r("unit-economics", schema.unitEconomics, "uec", "analytics", ro("analytics:reports:read")),
  r("journey-events", schema.journeyEvents, "jev", "analytics", ro("analytics:reports:read"), {
    immutable: true
  })
);

/** Module base path -> its resources, used for mounting and for OpenAPI. */
export const BY_MODULE: Record<string, Resource[]> = {
  core: CORE,
  dist: DIST,
  axis: AXIS,
  orbit: ORBIT,
  signal: SIGNAL,
  scout: SCOUT,
  north: NORTH,
  ledger: LEDGER,
  ai: AI,
  compliance: COMPLIANCE,
  analytics: ANALYTICS
};
