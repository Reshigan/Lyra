import { expect, test } from "@playwright/test";
import { goto } from "./fixtures.js";
import { totpAt, TOTP_STEP_SEC } from "@lyra/core";
import { expectNoA11yViolations } from "./a11y.js";
import { PERSONAS, SEED_PASSWORD, TENANT_SLUG } from "./env.js";

test.describe("sign-in", () => {
  test("the login screen has no WCAG 2.2 AA violations", async ({ page }) => {
    await goto(page, "/login");
    await expectNoA11yViolations(page);
  });

  test("demo persona one-click sign-in lands tenant.admin on the home workspace", async ({ page }) => {
    await goto(page, "/login");
    await page.getByRole("button", { name: new RegExp(PERSONAS.tenantAdmin.name) }).click();
    await page.waitForURL(/^http:\/\/[^/]+\/$/);
    await expect(page.getByLabel("Primary").getByRole("link", { name: "Administration" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("password sign-in with tenant slug reaches the same workspace", async ({ page }) => {
    await goto(page, "/login");
    await page.getByLabel(/email/i).fill(PERSONAS.tenantAdmin.email);
    await page.getByLabel(/password/i).fill(SEED_PASSWORD);
    const submit = page.getByRole("button", { name: "Continue", exact: true });
    await submit.click();

    // The API asks for a tenant slug when an address resolves to more than one
    // tenant; the field only renders after that first rejection (login.tsx).
    // isVisible() doesn't wait — the fetcher round-trip hasn't necessarily
    // re-rendered yet, so give the conditional field a real window to appear.
    const tenantField = page.getByLabel(/organi[sz]ation|tenant/i);
    const tenantShown = await tenantField
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (tenantShown) {
      await tenantField.fill(TENANT_SLUG);
      await submit.click();
    }

    // tenant.admin's role requires a second factor; first sign-in on a fresh
    // seed lands on enrolment (auth.ts) rather than the workspace directly.
    const setupKey = page.getByText(/^[A-Z2-7]{16,}$/);
    const enrolling = await setupKey
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (enrolling) {
      const secret = await setupKey.textContent();
      const code = await totpAt(secret!.trim(), Math.floor(Date.now() / 1000 / TOTP_STEP_SEC));
      await page.getByLabel(/verification code/i).fill(code);
      await page.getByRole("button", { name: "Confirm" }).click();

      // Confirming enrolment shows one-time recovery codes (login.tsx); that
      // screen must be acknowledged before the session is handed the workspace.
      await page.getByRole("button", { name: "I have saved them" }).click();
    }

    await page.waitForURL(/^http:\/\/[^/]+\/$/);
    await expect(page.getByLabel("Primary").getByRole("link", { name: "Administration" })).toBeVisible();
  });
});
