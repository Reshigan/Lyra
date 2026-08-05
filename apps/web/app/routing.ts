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
  "/platform",
  "/settings"
] as const;

export type WorkspacePath = (typeof WORKSPACE_PATHS)[number];

/**
 * Routes that will never appear in the nav, and why. The test asserts every
 * other route has a `nav.*` label key, so a new workspace cannot ship unlabelled.
 */
export const HIDDEN_ROUTES: Record<string, string> = {
  "/login": "pre-session: renders outside the shell, so there is no nav to be in",
  "/portal/:tenantSlug": "public comparison site, no session and no shell — reached from a tenant's own marketing link (ADR-0030)",
  "/logout": "action only, no UI",
  "/settings": "reached from the account menu in the header, not the module rail",
  "/approvals": "reached from the decisions-waiting panel on the home dashboard",
  "/search": "no UI of its own: the loader that feeds the command palette in the header",
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
  "/admin/permissions":
    "the per-role permission grid inside the admin workspace, linked from its tools list next to the roles tab",
  "/admin/developer":
    "the developer portal inside the admin workspace, linked from its tools list beside the API keys tab",
  "/admin/security":
    "the sign-in enforcement posture inside the admin workspace, linked from its tools list beside the sign-in providers tab",
  "/axis/exceptions": "the cross-resource work queue, linked from the AXIS workspace tools list",
  "/axis/board": "the production board of cases by state, linked from the AXIS workspace tools list",
  "/axis/quote-desk": "the quote desk and group bids, linked from the AXIS workspace tools list",
  "/axis/doc-intelligence": "extraction review over documents, linked from the AXIS workspace tools list",
  "/axis/documents/:id/file": "streams one document's source file, opened from the verify-queue viewer",
  "/axis/analytics": "operations analytics and exports, linked from the AXIS workspace tools list",
  "/axis/process-map": "the case-state flow diagram, linked from the AXIS workspace tools list",
  "/axis/admin": "SOP publish, connector health and operating policy, linked from the AXIS workspace tools list",
  "/axis/dev": "extraction sandbox for testing document parsing, linked from the admin developer tools sandbox card",
  "/axis/cases/:id/evidence-bundles/:bundleId/download":
    "streams one recon evidence bundle's file, opened from the case detail evidence list",
  "/signal/cockpit": "the growth read across the SIGNAL ledgers, linked from the signal workspace tools list",
  "/signal/studio":
    "creates a campaign and drafts its content, linked from the signal workspace tools list and from the cockpit when nothing is running",
  "/signal/audience-value": "value against cost per audience, linked from the signal workspace tools list",
  "/signal/answer-engines": "answer-engine coverage and citation share, linked from the signal workspace tools list",
  "/signal/budget":
    "the spend ceiling and the autopilot's bounds, linked from the signal workspace tools list and from the cockpit's autopilot panel",
  "/signal/analytics":
    "CAC, LTV and cohort retention with the spend export, linked from the signal workspace tools list and from the cockpit",
  "/admin/customers/:id/360": "opens everything known about one customer from the customers list",
  "/admin/products/:id/detail": "opens one product definition from the products list",
  "/axis/policies/:id/detail": "opens one policy with its history from the policies list",
  "/axis/claims/:id/detail": "opens one claim for assessment from the claims list",
  "/axis/cases/:id/detail": "opens one work item from the cases list",
  "/distribution/channels/:id/detail": "opens one distribution channel from the channels list",
  "/search/results": "the full result page behind the command palette, opened from its last row",
  "/onboarding/:kind/:ref": "one subject's onboarding checklist, opened from that partner, channel or staff record",
  "/orbit/console": "the live conversation console, linked from the ORBIT workspace tools list",
  "/orbit/save": "the retention save desk, linked from the ORBIT workspace tools list",
  "/orbit/pipeline": "the renewal pipeline, linked from the ORBIT workspace tools list",
  "/orbit/quality": "conversation quality review, linked from the ORBIT workspace tools list",
  "/orbit/analytics": "service and retention analytics, linked from the ORBIT workspace tools list",
  "/orbit/journeys/:id/builder": "opens one journey's steps from the journeys list",
  "/north/brief": "the executive briefing, linked from the NORTH workspace tools list",
  "/scout/radar": "the opportunity radar over clusters and whitespace, linked from the SCOUT workspace tools list",
  "/scout/panel": "panel benchmarks and the negotiation pack, linked from the SCOUT workspace tools list",
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
  platform: "/platform",
  dev: "/admin",
  customer: "/settings"
};

interface NavHref {
  href: string;
  children?: readonly NavHref[];
}

/** Nav is now grouped (heading items wrap the real destinations in
 *  `children`), so a leaf-only view needs both levels collected. */
function flattenHrefs(nav: readonly NavHref[]): string[] {
  return nav.flatMap((item) => [item.href, ...flattenHrefs(item.children ?? [])]);
}

/**
 * Where "/" sends this actor. Never sends them somewhere their nav does not
 * offer — a landing redirect into a 403 is a worse first paint than a list.
 */
export function landingFor(roles: readonly string[], nav: readonly NavHref[]): string {
  const hrefs = flattenHrefs(nav);
  const offered = new Set(hrefs);
  for (const role of roles) {
    const prefix = role.split(".")[0] ?? "";
    const path = HOME_BY_ROLE_PREFIX[prefix] ?? `/${prefix}`;
    if (offered.has(path) && isRouted(path)) return path;
  }
  // No role matched: the first thing they are allowed to open, or their own
  // settings, which every actor can always reach.
  return hrefs.find((href) => href !== "/" && isRouted(href)) ?? "/settings";
}

export function isRouted(path: string): boolean {
  return (WORKSPACE_PATHS as readonly string[]).includes(path);
}

/** `/axis` → `nav.axis`. The label itself comes from the catalogue. */
export function labelKeyFor(path: string): string {
  return `nav.${path.replace(/^\//, "") || "home"}`;
}
