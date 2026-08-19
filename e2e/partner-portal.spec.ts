import { expect, test } from "@playwright/test";
import { goto } from "./fixtures.js";

// J-X3 "portal signup -> sandbox key -> mock quote in < 30 min"
// (docs/06-roles-and-journeys.md; orbit.md §2.4's partner portal, "API keys,
// sandbox with mock quotes, docs, usage, revenue-share statements"). The whole
// journey through the public page, with no session at any point: the key the
// signup mints is the only credential, and partner-signup.spec.ts covers the
// same contract at the API.

test("J-X3 a partner signs up, gets a key, and prices a test case @journey:J-X3 @accept:M3", async ({ page }) => {
  await goto(page, "/portal/gonxt/partners");

  // The public surface wears the tenant's brand, never ours (CLAUDE.md §5).
  await expect(page.locator("main")).not.toContainText(/\bLYRA\b/);

  await page.getByLabel("Company name").fill(`J-X3 Portal Co ${Date.now()}`);
  await page.getByLabel("Work email address").fill(`jx3-portal-${Date.now()}@acme.example`);
  await page.getByRole("button", { name: "Create sandbox account" }).click();

  // Shown once, and said so. Nothing on this page ever shows it again.
  const keyPanel = page.getByRole("region", { name: "Your sandbox key" });
  await expect(keyPanel).toBeVisible();
  const key = ((await keyPanel.locator("pre").first().textContent()) ?? "").trim();
  expect(key).toMatch(/^qvk_test_[A-Z2-7]{40,}$/);
  const partnerId = ((await keyPanel.getByText(/^ptn_/).textContent()) ?? "").trim();

  const quote = page.getByRole("region", { name: "Your first quote" });
  await quote.getByLabel("Sandbox key").fill(key);
  await quote.getByLabel("Partner ID").fill(partnerId);
  await quote.getByLabel("Which product line?").fill("motor");
  await quote.getByLabel(/^Amount/).fill("120000");
  await quote.getByLabel(/^Currency/).fill("AED");
  await quote.getByRole("button", { name: "Get a test quote" }).click();

  // A price comes back, and the page says out loud that it is invented — a
  // sandbox number a partner mistakes for a real one is the failure here.
  await expect(quote.getByRole("status")).toBeVisible();
  await expect(quote).toContainText(/sandbox only/i);
  await expect(quote.getByText(/^otx_/)).toBeVisible();
});

test("J-X3 the console refuses a key that is not the partner's own @journey:J-X3 @accept:M3", async ({ page }) => {
  await goto(page, "/portal/gonxt/partners");

  // A stranger with a plausible id and no key learns nothing about whether the
  // id exists — the same message covers a bad key, a forbidden row and a
  // missing one.
  const console_ = page.getByRole("region", { name: "Sandbox console" });
  await console_.getByLabel("Sandbox key").fill("qvk_test_NOTAREALKEY");
  await console_.getByLabel("Partner ID").fill("ptn_0000000000000000");
  await console_.getByRole("button", { name: "Check my account" }).click();

  await expect(page.getByRole("alert")).toContainText("That key or partner ID was not accepted.");
  await expect(page.locator("main")).not.toContainText(/does not exist|not found|another tenant/i);
});
