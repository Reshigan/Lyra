import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

// Two kinds of screen live behind the session. Most of a workspace is lists and
// records, so those are one pair of generic routes driven by the specs in
// app/modules — adding a module adds a spec file, not a route. The screens that
// are genuinely their own thing (a quote comparison, a trial balance, the
// approvals queue) get a static path, which React Router ranks above the
// dynamic `:module` segment, so they win the match without extra ceremony.
export default [
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("portal/:tenantSlug", "routes/portal.$tenantSlug.tsx"),
  layout("routes/workspace.tsx", [
    index("routes/home.tsx"),

    route("settings", "routes/settings.tsx"),
    route("approvals", "routes/approvals.tsx"),
    route("admin/ai/console", "routes/ai-console.tsx"),
    route("admin/ai/budget", "routes/ai-budget.tsx"),
    route("admin/ai/runs/:id", "routes/ai-run.tsx"),
    route("admin/cost-explorer", "routes/cost-explorer.tsx"),
    route("ledger/reports/:report", "routes/ledger-reports.tsx"),
    route("ledger/transactions", "routes/ledger-open-txn.tsx"),
    route("ledger/transactions/:id", "routes/ledger-transaction.tsx"),
    route("ledger/period-close", "routes/ledger-periods.tsx"),
    route("ledger/statement", "routes/ledger-account.tsx"),
    route("ledger/recon", "routes/ledger-recon.tsx"),
    route("analytics/report/:id", "routes/analytics-report.tsx"),
    route("analytics/dashboard/:id", "routes/analytics-dashboard.tsx"),
    route("distribution/quote-requests/:id/compare", "routes/quote-compare.tsx"),
    route("orbit/conversations/:id/thread", "routes/conversation.tsx"),
    route("distribution/commission-entries/statement", "routes/commission-statement.tsx"),
    route("distribution/commission-entries/:id/clawback", "routes/commission-clawback.tsx"),
    route("distribution/next-best-offers/suggest", "routes/dist-offers.tsx"),
    route("compliance/run/:kind", "routes/compliance-run.tsx"),
    route("ledger/settlement", "routes/settlement.tsx"),
    route("ledger/settlements/:id", "routes/settlement-detail.tsx"),
    route("admin/permissions", "routes/admin-roles.tsx"),
    route("admin/developer", "routes/admin-developer.tsx"),
    route("admin/security", "routes/admin-security.tsx"),
    route("admin/staff", "routes/staff.tsx"),
    route("admin/staff/:id", "routes/staff-member.tsx"),
    route("platform", "routes/platform.tsx"),
    route("search", "routes/search.ts"),

    route("axis/exceptions", "routes/axis-exceptions.tsx"),
    route("axis/board", "routes/axis-board.tsx"),
    route("axis/quote-desk", "routes/axis-quote-desk.tsx"),
    route("axis/doc-intelligence", "routes/axis-doc-intel.tsx"),
    route("axis/analytics", "routes/axis-analytics.tsx"),
    route("axis/dev", "routes/axis-dev.tsx"),

    route("signal/cockpit", "routes/signal-cockpit.tsx"),
    route("signal/studio", "routes/signal-studio.tsx"),
    route("signal/audience-value", "routes/signal-audience-value.tsx"),
    route("signal/answer-engines", "routes/signal-answer-engines.tsx"),
    route("signal/budget", "routes/signal-budget.tsx"),
    route("signal/analytics", "routes/signal-analytics.tsx"),

    // Record screens: a static last segment, so each still ranks above the
    // generic `:module/:resource/:id`.
    route("admin/customers/:id/360", "routes/customer-360.tsx"),
    route("admin/products/:id/detail", "routes/product-detail.tsx"),
    route("axis/policies/:id/detail", "routes/policy-detail.tsx"),
    route("axis/claims/:id/detail", "routes/claim-detail.tsx"),
    route("axis/cases/:id/detail", "routes/case-detail.tsx"),
    route("distribution/channels/:id/detail", "routes/channel-detail.tsx"),

    route(":module", "routes/module.tsx"),
    route(":module/:resource", "routes/module.tsx", { id: "module-resource" }),
    route(":module/:resource/:id", "routes/record.tsx")
  ])
] satisfies RouteConfig;
