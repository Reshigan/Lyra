// The URL map. This file says which paths exist and where an actor lands; it
// says nothing about what a person may see — visibility and labels come from
// /v1/me, so a role change takes effect on the next request (docs/07 §3).

/** Module workspaces, in rail order. Must match what /v1/me can emit, or the
 *  rail silently drops an item the actor is entitled to (isRouted filters it). */
export const WORKSPACE_PATHS = [
  "/axis",
  "/orbit",
  "/signal",
  "/scout",
  "/north",
  "/distribution",
  "/ledger",
  "/analytics",
  "/compliance",
  "/admin",
  "/settings"
] as const;

export type WorkspacePath = (typeof WORKSPACE_PATHS)[number];

/**
 * Routes that will never appear in the nav, and why. The test asserts every
 * other route has a `nav.*` label key, so a new workspace cannot ship unlabelled.
 */
export const HIDDEN_ROUTES: Record<string, string> = {
  "/login": "pre-session: renders outside the shell, so there is no nav to be in",
  "/logout": "action only, no UI",
  "/settings": "reached from the account menu in the header, not the module rail",
  "/approvals": "reached from the decisions-waiting panel on the home dashboard",
  "/admin/ai/console": "a screen inside the admin workspace, reached from its AI tabs",
  "/admin/ai/budget": "the AI spending ceilings, reached from the admin workspace tools list",
  "/admin/cost-explorer": "unit-cost drift report, reached from the admin workspace tools list",
  "/admin/ai/runs/:id": "opens one agent run from the AI runs list or the console",
  "/ledger/reports/:report": "a report inside the ledger workspace, reached from its tabs",
  "/ledger/transactions": "opens a transaction inside the ledger workspace, linked from its tools list",
  "/ledger/transactions/:id": "opens one transaction from the ledger transactions list",
  "/ledger/period-close": "closes an accounting period, linked from the ledger workspace tools list",
  "/ledger/statement": "one account's journal lines, linked from the ledger workspace tools list",
  "/ledger/recon": "reconciliation runs inside the ledger workspace, linked from its tools list",
  "/ledger/settlement": "commission settlement runs inside the ledger workspace, linked from its tools list",
  "/ledger/settlements/:id": "opens one settlement from the settlement runs list",
  "/admin/staff": "a screen inside the admin workspace, reached from its staff tab",
  "/admin/staff/:id": "opens one staff member from the staff directory",
  "/analytics/report/:id": "opens one saved report from the analytics report list",
  "/analytics/dashboard/:id": "opens one dashboard from the analytics dashboard list",
  "/distribution/quote-requests/:id/compare": "opens from a single quote request record",
  "/orbit/conversations/:id/thread": "opens from a single conversation record",
  "/distribution/commission-entries/statement":
    "a report inside the distribution workspace, linked from its commission tab",
  "/distribution/commission-entries/:id/clawback":
    "opens from a single commission entry on the statement",
  "/distribution/next-best-offers/suggest":
    "asks for offers inside the distribution workspace, linked from its offers tab",
  "/compliance/run/:kind":
    "starts a screening, evidence export or retention run, linked from the compliance workspace",
  "/:module": "the generic workspace list; the rail links the real paths",
  "/:module/:resource": "a resource tab inside a workspace, linked from its tab strip",
  "/:module/:resource/:id": "a single record, linked from the list that holds it"
};

/**
 * docs/07 §3: home per role is that role's primary workspace. Role keys are
 * `<prefix>.<level>`, and for module roles the prefix is the module — so
 * `axis.lead` lands on /axis without a table to maintain. Only the prefixes
 * that are not module names need an entry.
 */
const HOME_BY_ROLE_PREFIX: Record<string, string> = {
  tenant: "/admin",
  platform: "/admin",
  dev: "/admin",
  customer: "/settings"
};

/**
 * Where "/" sends this actor. Never sends them somewhere their nav does not
 * offer — a landing redirect into a 403 is a worse first paint than a list.
 */
export function landingFor(roles: readonly string[], nav: readonly { href: string }[]): string {
  const offered = new Set(nav.map((item) => item.href));
  for (const role of roles) {
    const prefix = role.split(".")[0] ?? "";
    const path = HOME_BY_ROLE_PREFIX[prefix] ?? `/${prefix}`;
    if (offered.has(path) && isRouted(path)) return path;
  }
  // No role matched: the first thing they are allowed to open, or their own
  // settings, which every actor can always reach.
  return nav.map((item) => item.href).find((href) => href !== "/" && isRouted(href)) ?? "/settings";
}

export function isRouted(path: string): boolean {
  return (WORKSPACE_PATHS as readonly string[]).includes(path);
}

/** `/axis` → `nav.axis`. The label itself comes from the catalogue. */
export function labelKeyFor(path: string): string {
  return `nav.${path.replace(/^\//, "") || "home"}`;
}
