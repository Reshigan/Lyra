import { expect, test } from "@playwright/test";
import { PERSONAS } from "./env.js";
import { goto, loginAsFinanceController, loginAsScoutLead, pickPersona } from "./fixtures.js";

// J-P2 "panel negotiation" (docs/06-roles-and-journeys.md:75): "bench alert ->
// negotiation pack -> meeting -> commission/coverage delta logged." The
// acceptance test this journey actually has (apps/api/src/journeys.test.ts
// :993-1020) is two independent checks: a rate change is create-only and
// always dual-controlled (dist.rate_change, packages/core/src/approvals.ts:59
// — dualControl "always", neverAutoApprove: true), and panel benchmarks are
// readable by whoever negotiates them (scout:panel_bench:read).
//
// There is no "negotiation pack" or "meeting" affordance anywhere in
// apps/web/app/modules — those are the docs' aspirational framing around the
// same two API surfaces. Per CLAUDE.md's TDD rule (the spec wins), this file
// covers only what journeys.test.ts actually established: the gated rate
// change, and the readable benchmark table. scout.lead has neither
// dist:rates:write nor dist:rates:approve (packages/core/src/rbac.ts), so the
// rate-change half runs as tenant.admin (raises) and finance.controller
// (decides) — mirroring the actor split the acceptance test itself uses
// ("tenant.admin" attempts, "finance.controller" decides) — each in its own
// browser context, as ai-console.spec.ts's J-A3 does for its own two-actor
// journey.
test("J-P2 a commission rate change is refused for dual control, then decided by the controller @journey:J-P2 @accept:M5", async ({
  browser
}) => {
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await adminPage.goto("/login");
  await pickPersona(adminPage, PERSONAS.tenantAdmin.name);
  await adminPage.waitForURL(/^http:\/\/[^/]+\/$/);

  await adminPage.goto("/distribution/commission-rates");
  await adminPage.getByText("New — Commission rates").click();
  const channelId = `J-P2-channel-${Date.now()}`;
  await adminPage.getByLabel("Channel*", { exact: true }).fill(channelId);
  await adminPage.getByLabel("Channel share*", { exact: true }).fill("500000");
  await adminPage.getByLabel("Effective from*", { exact: true }).fill("2026-08-01");
  await adminPage.getByRole("button", { name: "Create", exact: true }).click();

  // dist.rate_change is never auto-approved and always dual control
  // (packages/core/src/approvals.ts:59), so the first attempt is always a
  // refusal — the shared Problem box renders the policy key as the detail
  // (packages/core/src/errors.ts's approvalRequired).
  // toContainText, not toHaveText: the alert also carries a requestId line
  // (module.tsx's Problem component) alongside the policy key.
  await expect(adminPage.getByRole("alert")).toContainText("dist.rate_change");
  // Nothing was written: the refused channel id never appears as a row.
  await expect(adminPage.getByRole("row", { name: new RegExp(channelId) })).toHaveCount(0);

  // The controller holds dist:rates:approve; the admin who asked does not
  // (rbac.ts) — a second, independent browser context decides it.
  const controller = await browser.newContext();
  const controllerPage = await controller.newPage();
  await loginAsFinanceController(controllerPage);

  // The seed already carries one *decided* dist.rate_change approval
  // (packages/core/src/seed/admin.ts:253-263, decision: "approved"), and
  // /approvals defaults to the pending state (approvals.tsx:130) — so the row
  // this test just raised is the only rate-change card *this run* adds. The
  // card is headed by the policy read as words (approvals.tsx policyTitle) —
  // "Dist rate change", not `dist.rate_change`. Earlier runs against a reused
  // DB leave their own identical pending cards behind, and any one of them
  // decides the same way, so take the first.
  await controllerPage.goto("/approvals");
  const request = controllerPage.getByRole("region", { name: "Dist rate change" }).first();
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(controllerPage.getByRole("status")).toHaveText("Approved. The action may now proceed.");
});

// scout:panel_bench:read (rbac.ts) is the read behind "bench alert" — the
// benchmark table the negotiation pack is quoted from
// (packages/core/src/seed/scout.ts's seeded motor/health rows).
test("J-P2 panel benchmarks are readable by the negotiator @journey:J-P2 @accept:M5", async ({ page }) => {
  await loginAsScoutLead(page);

  await goto(page, "/scout/panel-bench");
  // Seeded rows carry a plain-text "line" column (packages/core/src/seed
  // /scout.ts) — motor rows across two periods, so at least one row renders.
  await expect(page.getByRole("row", { name: /motor/ }).first()).toBeVisible();
});
