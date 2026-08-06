import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { goto, loginAsComplianceOfficer, loginAsTenantAdmin } from "./fixtures.js";

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
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

const EN_PAGES: Array<[string, string]> = [
  ["/", "en-home"],
  ["/approvals", "en-approvals"],
  ["/axis/board", "en-axis-board"],
  ["/admin/customers", "en-customers-list"],
  ["/ledger/transactions", "en-ledger-transactions"],
  ["/settings", "en-settings"]
];

const AR_PAGES: Array<[string, string]> = [
  ["/", "ar-home"],
  ["/approvals", "ar-approvals"],
  ["/settings", "ar-settings"],
  ["/compliance", "ar-compliance"]
];

test("tour: english (tenant admin)", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsTenantAdmin(page);
  for (const [path, name] of EN_PAGES) await shoot(page, path, name);
  if (CUSTOMER_ID) await shoot(page, `/admin/customers/${CUSTOMER_ID}/360`, "en-customer-360");
});

test("tour: arabic (compliance officer)", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsComplianceOfficer(page);
  for (const [path, name] of AR_PAGES) await shoot(page, path, name);
  if (CUSTOMER_ID) await shoot(page, `/admin/customers/${CUSTOMER_ID}/360`, "ar-customer-360");
});
