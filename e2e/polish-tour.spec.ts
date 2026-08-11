import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import {
  goto,
  loginAsAxisLead,
  loginAsComplianceOfficer,
  loginAsFinanceController,
  loginAsNorthExec,
  loginAsOrbitAgent,
  loginAsScoutLead,
  loginAsSignalLead,
  loginAsTenantAdmin
} from "./fixtures.js";

// ponytail: throwaway visual-audit tour, not a journey test — asserts nothing,
// just captures full-page screenshots for human/model review. Delete or ignore
// in CI; promote to visual regression (toHaveScreenshot) if we ever want gates.
const OUT = process.env.POLISH_OUT ?? "/tmp/lyra-polish-shots";
const CUSTOMER_ID = process.env.POLISH_CUSTOMER_ID ?? "";
test.skip(!process.env.POLISH_OUT, "visual tour, opt-in via POLISH_OUT");
if (process.env.POLISH_OUT) mkdirSync(OUT, { recursive: true });

async function shoot(page: Page, path: string, name: string) {
  await goto(page, path);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

// Every screen a signed-in person can reach without knowing a record id. The
// record screens (`/axis/policies/:id/detail` and friends) need a seeded id and
// are toured separately via POLISH_CUSTOMER_ID.
const ADMIN_PAGES: Array<[string, string]> = [
  ["/", "home"],
  ["/settings", "settings"],
  ["/approvals", "approvals"],
  ["/platform", "platform"],
  ["/search/results?q=motor", "search-results"],
  ["/admin/ai/console", "ai-console"],
  ["/admin/ai/budget", "ai-budget"],
  ["/admin/cost-explorer", "cost-explorer"],
  ["/admin/permissions", "admin-permissions"],
  ["/admin/developer", "admin-developer"],
  ["/admin/security", "admin-security"],
  ["/admin/staff", "admin-staff"],
  ["/admin/customers", "customers-list"],
  ["/admin/products", "products-list"]
];

const AXIS_PAGES: Array<[string, string]> = [
  ["/axis/board", "axis-board"],
  ["/axis/exceptions", "axis-exceptions"],
  ["/axis/quote-desk", "axis-quote-desk"],
  ["/axis/doc-intelligence", "axis-doc-intelligence"],
  ["/axis/analytics", "axis-analytics"],
  ["/axis/admin", "axis-admin"],
  ["/axis/dev", "axis-dev"],
  ["/axis/process-map", "axis-process-map"],
  ["/axis/claims/new", "axis-claims-new"],
  ["/axis/claims/desk", "axis-claims-desk"],
  ["/axis/renewals", "axis-renewals"],
  ["/axis/policies", "axis-policies-list"],
  ["/axis/cases", "axis-cases-list"]
];

const FINANCE_PAGES: Array<[string, string]> = [
  ["/ledger/transactions", "ledger-transactions"],
  ["/ledger/money-map", "ledger-money-map"],
  ["/ledger/period-close", "ledger-period-close"],
  ["/ledger/statement", "ledger-statement"],
  ["/ledger/recon", "ledger-recon"],
  ["/ledger/settlement", "ledger-settlement"],
  ["/ledger/reports/trial-balance", "ledger-trial-balance"],
  ["/distribution/commission-entries/statement", "commission-statement"],
  ["/distribution/next-best-offers/suggest", "dist-next-best-offers"],
  ["/distribution/channels", "dist-channels-list"]
];

const ORBIT_PAGES: Array<[string, string]> = [
  ["/orbit/console", "orbit-console"],
  ["/orbit/save", "orbit-save"],
  ["/orbit/pipeline", "orbit-pipeline"],
  ["/orbit/quality", "orbit-quality"],
  ["/orbit/analytics", "orbit-analytics"],
  ["/orbit/conversations", "orbit-conversations-list"]
];

const SIGNAL_PAGES: Array<[string, string]> = [
  ["/signal/cockpit", "signal-cockpit"],
  ["/signal/studio", "signal-studio"],
  ["/signal/audience-value", "signal-audience-value"],
  ["/signal/answer-engines", "signal-answer-engines"],
  ["/signal/budget", "signal-budget"],
  ["/signal/analytics", "signal-analytics"],
  ["/signal/campaigns", "signal-campaigns-list"]
];

const SCOUT_PAGES: Array<[string, string]> = [
  ["/scout/radar", "scout-radar"],
  ["/scout/panel", "scout-panel"],
  ["/scout/clusters", "scout-clusters-list"]
];

const NORTH_PAGES: Array<[string, string]> = [
  ["/north/brief", "north-brief"],
  ["/north/snapshots", "north-snapshots-list"]
];

const COMPLIANCE_PAGES: Array<[string, string]> = [
  ["/compliance/dsar-requests", "compliance-dsar-list"],
  ["/compliance/run/dsar", "compliance-run-dsar"]
];

// Public surfaces — no session at all, which is how a stranger meets the brand.
const PUBLIC_PAGES: Array<[string, string]> = [
  ["/login", "public-login"],
  ["/portal/gonxt", "public-portal"],
  ["/portal/gonxt/privacy", "public-portal-privacy"]
];

async function tour(page: Page, pages: Array<[string, string]>, prefix: string) {
  for (const [path, name] of pages) await shoot(page, path, `${prefix}-${name}`);
}

test("tour: public (no session)", async ({ page }) => {
  test.setTimeout(120_000);
  await tour(page, PUBLIC_PAGES, "en");
});

test("tour: admin (english)", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsTenantAdmin(page);
  await tour(page, ADMIN_PAGES, "en");
  if (CUSTOMER_ID) await shoot(page, `/admin/customers/${CUSTOMER_ID}/360`, "en-customer-360");
});

test("tour: axis", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsAxisLead(page);
  await tour(page, AXIS_PAGES, "en");
});

test("tour: finance", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsFinanceController(page);
  await tour(page, FINANCE_PAGES, "en");
});

test("tour: orbit", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsOrbitAgent(page);
  await tour(page, ORBIT_PAGES, "en");
});

test("tour: signal", async ({ page }) => {
  test.setTimeout(300_000);
  await loginAsSignalLead(page);
  await tour(page, SIGNAL_PAGES, "en");
});

test("tour: scout", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsScoutLead(page);
  await tour(page, SCOUT_PAGES, "en");
});

test("tour: north", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsNorthExec(page);
  await tour(page, NORTH_PAGES, "en");
});

test("tour: arabic (compliance officer, RTL)", async ({ page }) => {
  test.setTimeout(240_000);
  await loginAsComplianceOfficer(page);
  await tour(page, COMPLIANCE_PAGES, "ar");
  await tour(page, [["/", "home"], ["/approvals", "approvals"], ["/settings", "settings"]], "ar");
});
