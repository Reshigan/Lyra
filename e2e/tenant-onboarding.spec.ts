import { expect, test } from "@playwright/test";
import { loginAsTenantAdmin } from "./fixtures.js";

// J-A1 "new tenant in a day" (docs/06-roles-and-journeys.md:87-89): the docs'
// prose is a platform.admin flow — create tenant -> brand upload (contrast
// auto-check) -> entitlements -> domain -> invite tenant.admin -> synthetic
// smoke suite green. None of that exists as a persona, a route or an
// affordance in this codebase: PERSONAS (e2e/env.ts) has no platform.admin
// (only tenant.admin and eight other tenant-scoped personas), there is no
// tenant-creation form anywhere in apps/web (the "tenants" tab's own comment,
// apps/web/app/modules/admin.ts:613-614, says so explicitly: "Creating a
// tenant is a platform act, not a tenant act: this tab edits the one you are
// signed in to"), and there is no smoke-suite or domain-binding screen.
//
// The acceptance test this journey actually has (apps/api/src/journeys.test.ts
// :1107-1127) is narrower and answers a different question: not "can a new
// tenant be created", but "is the seeded tenant complete enough to work in",
// plus "core_tenants is scoped to the signed-in tenant's own row, never a
// cross-tenant list". Per CLAUDE.md's TDD rule, this spec matches that real,
// reachable scope:
//   1. tenant.plan === "enterprise", tenant.brand is truthy, roles.length > 10,
//      agents.length >= 8 (journeys.test.ts:1108-1116)
//   2. GET /v1/core/tenants returns exactly one row, this tenant's own, by
//      slug "gonxt" (journeys.test.ts:1118-1126)
//
// The UI surface for all of this is the admin workspace's generic list/record
// screens (apps/web/app/routes/module.tsx, record.tsx), driven by
// apps/web/app/modules/admin.ts's tenants/roles/agents tabs — there is no
// bespoke onboarding screen to visit instead.
test("J-A1 the seeded tenant is complete enough to work in", async ({ page }) => {
  await loginAsTenantAdmin(page);

  // roles.length > 10 and agents.length >= 8 — neither tab declares `search`
  // or a default filter, and both lists sit well under the API's default page
  // size of 50 (apps/api/src/http.ts), so the unfiltered list's row count
  // (module.tsx's footer, "common.rows": "{count} shown") is the row count.
  await page.goto("/admin/roles");
  await expect(page.getByRole("table")).toBeVisible();
  const roleRows = await page.getByRole("row").count();
  // Header row + data rows; subtract the header to get roles.data.length.
  expect(roleRows - 1).toBeGreaterThan(10);

  await page.goto("/admin/agents");
  await expect(page.getByRole("table")).toBeVisible();
  const agentRows = await page.getByRole("row").count();
  expect(agentRows - 1).toBeGreaterThanOrEqual(8);

  // tenant.plan === "enterprise" and tenant.brand is truthy — both surface on
  // the tenants tab: plan is a plain column, brand is not a column (admin.ts's
  // tenants tab only lists it under `editable`), so it only ever reaches the
  // screen as the "Brand" JSON textarea on the tenant's own record page
  // (record.tsx's edit Form, FieldInput -> inputValue JSON.stringifies it).
  await page.goto("/admin/tenants");
  const tenantRow = page.getByRole("row", { name: /gonxt/ });
  await expect(tenantRow).toBeVisible();
  await expect(tenantRow).toContainText("enterprise");
  await tenantRow.getByRole("link").first().click();
  await page.waitForURL(/\/admin\/tenants\/.+/);

  const brandField = page.getByLabel("Brand", { exact: true });
  await expect(brandField).toBeVisible();
  await expect(brandField).toHaveValue(/GONXT/);
});

test("J-A1 the tenants tab lists its own tenant row and nobody else's", async ({ page }) => {
  await loginAsTenantAdmin(page);

  // core_tenants has no tenant_id column — scoping it by its own id is the
  // only thing that keeps this list from erroring or spanning tenants
  // (apps/api/src/journeys.test.ts:1119-1120's comment, verbatim). The e2e
  // fixture seeds exactly one tenant, so "nobody else's" shows up here as
  // "exactly one row" — there is no second tenant this stack could leak.
  await page.goto("/admin/tenants");
  await expect(page.getByRole("row")).toHaveCount(2); // header + the one seeded tenant
  const row = page.getByRole("row", { name: /gonxt/ });
  await expect(row).toBeVisible();

  await row.getByRole("link").first().click();
  await page.waitForURL(/\/admin\/tenants\/.+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("GONXT");
  // Slug is a `columns` field, not `editable` (admin.ts's tenants tab), so it
  // renders only in the record's read-only <dl>, never as a form input.
  await expect(page.locator("dl").getByText("gonxt", { exact: true })).toBeVisible();
});
