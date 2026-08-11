import { expect, test } from "@playwright/test";
import { goto, pickPersona } from "./fixtures.js";
import { expectNoA11yViolations } from "./a11y.js";
import { PERSONAS } from "./env.js";

// J-A2 "New teammate" (docs/06-roles-and-journeys.md §Admin & Dev): a
// tenant.admin invites someone, assigns a role bundle, and that access is
// visible immediately — no separate activation step.
test("J-A2 admin invites a teammate and the role bundle is visible immediately @journey:J-A2 @accept:M1", async ({ page }) => {
  await goto(page, "/login");
  await pickPersona(page, PERSONAS.tenantAdmin.name);
  await page.waitForURL(/^http:\/\/[^/]+\/$/);

  await goto(page, "/admin/staff");
  await expectNoA11yViolations(page);

  const email = `j-a2-${Date.now()}@gonxt.ae`;
  const name = "Priya Nair";
  await page.getByLabel("Email*", { exact: true }).fill(email);
  await page.getByLabel("Name*", { exact: true }).fill(name);
  await page.getByRole("checkbox", { name: "Tenant administrator" }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByRole("heading", { name: "Invited", level: 3 })).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(email) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Invited")).toBeVisible();
});
