import { expect, test, type Page } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { makeLibsqlDb } from "@lyra/db/libsql";
import type { Ctx } from "@lyra/core";
import { sweepRenewals } from "../apps/api/src/engines/renewals.js";
import { goto, loginAsAxisLead, loginAsOrbitRetention } from "./fixtures.js";
import { LIBSQL_URL, TENANT_SLUG } from "./env.js";

// AXIS task 11 (docs/14 M?): the mid-term change and cancellation screens
// (policy-endorse.tsx, policy-cancel.tsx) and the renewal desk
// (renewal-desk.tsx). Each write is priced first and confirmed second
// (§B.1/§B.2/§D.5/D.7) — these tests exercise both steps end to end.

// CDR-MOT-2601-778201 (seed.ts's `policyId`): not consumed by any other e2e
// spec, unlike renewalPolicyId (orbit-journeys.spec.ts's J-C3).
const POLICY_NO = "CDR-MOT-2601-778201";

/**
 * The generic policies list (module.tsx) links each row's first column to
 * the generic record route (/axis/policies/{id}), not the static
 * /axis/policies/{id}/detail route — so the id is extracted from the URL
 * after that click, then /detail is navigated to explicitly.
 */
async function openPolicyDetail(page: Page, policyNo: string): Promise<string> {
  await goto(page, `/axis/policies?q=${encodeURIComponent(policyNo)}`);
  const row = page.getByRole("row", { name: new RegExp(policyNo) });
  await row.getByRole("link").first().click();
  await page.waitForURL(/\/axis\/policies\/[^/?]+$/);
  const id = page.url().split("/").pop()!;
  await goto(page, `/axis/policies/${id}/detail`);
  return id;
}

test("axis lead endorses a policy: price the change, then confirm it", async ({ page }) => {
  await loginAsAxisLead(page);
  const id = await openPolicyDetail(page, POLICY_NO);

  await page.getByRole("link", { name: "Endorse" }).click();
  await page.waitForURL(`**/axis/policies/${id}/endorse`);

  // Deliberately no premiumMinor: a premium change routes through the
  // referral gate (preview.needsReferral disables the confirm button),
  // which is out of scope for this test.
  await page.getByLabel("Changes (JSON)").fill(JSON.stringify({ note: "e2e endorsement" }));
  await page.getByRole("button", { name: "Price this change" }).click();

  await expect(page.getByText("Pro-rata days")).toBeVisible();
  await page.getByRole("checkbox", { name: "I have checked the figures above and want this change written." }).check();
  await page.getByRole("button", { name: "Confirm the endorsement" }).click();

  await expect(page.getByRole("heading", { name: "Endorsement written" })).toBeVisible();
});

test("axis lead prices a cancellation, which holds for approval rather than writing", async ({ page }) => {
  await loginAsAxisLead(page);
  const id = await openPolicyDetail(page, POLICY_NO);

  await page.getByRole("link", { name: "Cancel" }).click();
  await page.waitForURL(`**/axis/policies/${id}/cancel`);

  await page.getByLabel("Reason").fill("e2e cancellation");
  await page.getByRole("button", { name: "Price this cancellation" }).click();

  await expect(page.getByText("Pro-rata days")).toBeVisible();
  await expect(page.getByText("Refund", { exact: true })).toBeVisible();
  await expect(page.getByText("Commission clawback")).toBeVisible();

  await page.getByRole("checkbox", { name: "I have checked the figures above and want this cancellation written." }).check();
  await page.getByRole("button", { name: "Confirm the cancellation" }).click();

  // axis.cancel gates unconditionally when refundMinor is nonzero and this
  // tenant's auto_approve allowlist does not cover it — so the honest
  // outcome is the approval gate, not a written cancellation.
  await expect(page.getByRole("status").getByText("This cancellation needs an approval first")).toBeVisible();
});

async function runRenewalsSweep(): Promise<void> {
  const db = makeLibsqlDb(LIBSQL_URL);
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG));
  if (!tenant) throw new Error(`no tenant with slug ${TENANT_SLUG}`);

  const [soonest] = await db
    .select({ id: schema.axisPolicies.id, endAt: schema.axisPolicies.endAt })
    .from(schema.axisPolicies)
    .where(and(eq(schema.axisPolicies.tenantId, tenant.id), eq(schema.axisPolicies.status, "active")))
    .orderBy(asc(schema.axisPolicies.endAt))
    .limit(1);
  if (!soonest) throw new Error("no active policy to raise a renewal from");

  // The e2e DB isn't wiped between local runs (global-setup.ts), and this
  // test's own "Do not contact" click moves the renewal row it creates out
  // of scheduled/offered — sweepRenewals' dedupe then sees a still-live row
  // for this policy and skips it, leaving the desk empty on a repeat run.
  // Clear any prior row for this exact policy first so the sweep is fresh.
  await db.delete(schema.orbitRenewals).where(eq(schema.orbitRenewals.policyRef, soonest.id));

  await sweepRenewals({
    db: db as unknown as Ctx["db"],
    tenantId: tenant.id,
    actor: { kind: "system", id: "e2e-sweep", tenantId: tenant.id, grants: [] },
    requestId: "e2e-sweep",
    now: soonest.endAt,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  });
}

test("orbit retention works a renewal from the AXIS renewal desk", async ({ page }) => {
  await runRenewalsSweep();
  await loginAsOrbitRetention(page);
  await goto(page, "/axis/renewals");

  const row = page.locator("tbody tr").first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Auto re-quote" }).click();
  await expect(page.getByRole("status").getByText("Recorded.")).toBeVisible();

  await row.getByRole("button", { name: "Do not contact" }).click();
  await expect(page.getByRole("status").getByText("Recorded.")).toBeVisible();

  // Gap: "Bind renewal" has no coverage here — orbit.retention holds
  // orbit:renewals:update but not axis:policies:renew, and axis.lead (who
  // does) lacks orbit:renewals:read, so no persona can reach this screen's
  // bind action through its own UI.
});
