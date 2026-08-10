import { expect, test } from "@playwright/test";
import { goto, loginAsComplianceOfficer } from "./fixtures.js";

// J-CO1 "Regulator request" (docs/06-roles-and-journeys.md §Compliance): a
// tenant.compliance officer scopes the query, exports a signed audit bundle,
// and it is delivered same day.
//
// khalid.rashed's locale is "ar" (packages/core/src/seed.ts), so every label
// this spec matches is the Arabic string from compliance-run.tsx's own LABELS
// table — this screen owns its strings rather than reading the shared en/ar
// catalogues. Purpose defaults to "regulator" (طلب من الجهة الرقابية), which
// is already the right scope for this journey, so the Select is left alone.
test("J-CO1 compliance officer scopes and exports a signed evidence bundle @journey:J-CO1 @accept:M6", async ({ page }) => {
  await loginAsComplianceOfficer(page);

  await goto(page, "/compliance/run/evidence");
  await expect(page.getByRole("heading", { name: "عمليات الامتثال", level: 1 })).toBeVisible();

  await page.getByLabel("الموضوع", { exact: true }).fill("customer-91827");
  await page.getByLabel("أُعدّت لصالح", { exact: true }).fill("الجهة الرقابية الاتحادية");
  await page.getByRole("button", { name: "إنشاء الحزمة", exact: true }).click();

  await expect(page.getByRole("heading", { name: "الحزمة" })).toBeVisible();
  await expect(page.getByText("جاهزة", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "تنزيل الحزمة" })).toBeVisible();
});
