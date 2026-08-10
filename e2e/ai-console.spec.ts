import { expect, test } from "@playwright/test";
import { PERSONAS } from "./env.js";
import { loginAsComplianceOfficer } from "./fixtures.js";

// J-A3 "Incident pause" (docs/06-roles-and-journeys.md §Admin & Dev): one-click
// pause an agent, a banner shows degraded mode, resume with an audit note.
//
// packages/core/src/rbac.ts splits this by design: tenant.compliance holds
// ai:agents:pause (and reads, never authors), tenant.admin holds
// ai:agents:write (runs the agents, including resume) — never the same role,
// so the journey is genuinely two people. khalid.rashed (tenant.compliance,
// locale "ar") pauses the seeded "briefing" agent with a reason; amina.saleh
// (tenant.admin, locale "en") resumes it. Playwright's fullyParallel mode
// gives no ordering guarantee across tests, so both halves run inside one
// test, each in its own browser context, strictly sequenced.
//
// apps/web/app/routes/ai-console.tsx's resume <Form> carries only
// intent=resume and agentKey — no reason/note field at all. That is a real
// gap against "resume with an audit note": this spec asserts the gap (no
// textarea in the resumed card) rather than inventing a field that isn't
// there.
//
// The "briefing" agent is a fixed seeded singleton, not a fresh row this test
// creates itself — e2e/global-setup.ts deliberately skips wiping the shared
// DB when it already exists (a prior run's API process keeps the file open),
// so a paused-but-never-resumed leftover from an earlier run of this exact
// spec persists into every later run. Every other spec in this batch dodges
// that by creating its own uniquely-timestamped row; this one can't, so it
// self-heals to "active" first rather than assuming the seed's baseline.
test("J-A3 compliance officer pauses an agent with a reason, admin resumes it @journey:J-A3", async ({ browser }) => {
  const reason = `J-A3-${Date.now()} runaway briefing spend, pausing pending investigation`;

  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await adminPage.goto("/login");
  await adminPage.getByRole("button", { name: new RegExp(PERSONAS.tenantAdmin.name) }).click();
  await adminPage.waitForURL(/^http:\/\/[^/]+\/$/);
  await adminPage.goto("/admin/ai/console");

  const enCard = adminPage.getByRole("region", { name: /Executive briefing/ });
  await expect(enCard).toBeVisible();
  if (await enCard.getByText("Paused", { exact: true }).isVisible()) {
    await enCard.getByRole("button", { name: "Resume agent", exact: true }).click();
    await expect(enCard.getByText("Active", { exact: true })).toBeVisible();
  }

  // -- khalid.rashed pauses --------------------------------------------------
  const compliance = await browser.newContext();
  const compliancePage = await compliance.newPage();
  await loginAsComplianceOfficer(compliancePage);
  await compliancePage.goto("/admin/ai/console");

  const arCard = compliancePage.getByRole("region", { name: /الإحاطة التنفيذية/ });
  await expect(arCard).toBeVisible();
  await expect(arCard.getByText("نشط", { exact: true })).toBeVisible();

  await arCard.getByLabel("السبب", { exact: true }).fill(reason);
  await arCard.getByRole("button", { name: "إيقاف الوكيل", exact: true }).click();
  await expect(arCard.getByText("موقوف", { exact: true })).toBeVisible();

  await compliance.close();

  // -- amina.saleh resumes ----------------------------------------------------
  await adminPage.reload();
  await expect(enCard.getByText("Paused", { exact: true })).toBeVisible();

  // The confirmed gap: no reason/audit-note field on the resume path. Scoped
  // to the resume <Form> itself (matched by its hidden intent input) — the
  // card also renders AutonomyForm alongside it, which has its own reason
  // textarea for a different action (changing autonomy level), so asserting
  // against the whole region would fail on that unrelated field instead.
  const resumeForm = enCard.locator('form:has(input[name="intent"][value="resume"])');
  await expect(resumeForm.locator("textarea")).toHaveCount(0);

  await enCard.getByRole("button", { name: "Resume agent", exact: true }).click();
  await expect(enCard.getByText("Active", { exact: true })).toBeVisible();

  await admin.close();
});
