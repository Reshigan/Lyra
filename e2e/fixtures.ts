import type { Page } from "@playwright/test";
import { PERSONAS } from "./env.js";

/**
 * `page.goto` that comes back once React has hydrated, not merely once the
 * document loaded. Anything typed before hydration is thrown away — React
 * resets an uncontrolled input to its server-rendered `defaultValue` as it
 * hydrates — and under `vite dev`'s module waterfall hydration lands well
 * after "load". The symptom is a silent one: the field is empty, so a
 * `required` control blocks its own form and no request is ever made.
 *
 * `__reactRouterDataRouter` is set on `window` by react-router's
 * HydratedRouter, which is the last thing hydration does, so its presence is
 * the signal. Client-side navigation (a <Link> click) needs none of this —
 * the page is hydrated by definition.
 */
export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => "__reactRouterDataRouter" in window);
}

/**
 * The demo one-click door (apps/web/app/routes/login.tsx), amina.saleh@gonxt.ae
 * — tenant.admin. The demo action always redirects to "next" (home.tsx), which
 * defaults to "/" — there is no role-based landing redirect wired into any
 * route (routing.ts's `landingFor` is exercised only by shell.test.ts, not by
 * an actual loader), so this follows the same "Administration" nav link a real
 * tenant.admin clicks from the home dashboard to reach /admin.
 */
export async function loginAsTenantAdmin(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.tenantAdmin.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
  // "Administration" also appears in the home page's "Workspaces" quick-links
  // list — the primary nav rail is the one always-present copy.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Administration", exact: true }).click();
  await page.waitForURL(/\/admin/);
}

/** layla.hassan@gonxt.ae — axis.agent, owns AXIS cases. */
export async function loginAsAxisAgent(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.axisAgent.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** nadia.rahman@gonxt.ae — finance.controller, holds ledger:*:* (recon read/run/confirm). */
export async function loginAsFinanceController(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.financeController.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** hala.zayed@gonxt.ae — north.exec, reads briefings/anomalies/scenarios, no locale override (en). */
export async function loginAsNorthExec(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.northExec.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** khalid.rashed@gonxt.ae — tenant.compliance, locale "ar": the UI renders in Arabic for this persona. */
export async function loginAsComplianceOfficer(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.complianceOfficer.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** omar.farouk@gonxt.ae — axis.lead, holds axis:policies:create (axis.agent does not). */
export async function loginAsAxisLead(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.axisLead.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** faisal.omar@gonxt.ae — a second, independent finance.controller (distinct from Nadia Rahman). */
export async function loginAsFinanceController2(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.financeController2.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** noor.jamal@gonxt.ae — signal.lead, owns SIGNAL budget moves/campaigns/AEO pages. */
export async function loginAsSignalLead(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.signalLead.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** tariq.mansour@gonxt.ae — scout.lead, owns SCOUT whitespaces/signals. */
export async function loginAsScoutLead(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.scoutLead.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** sara.nasser@gonxt.ae — orbit.agent, owns ORBIT conversations/handover notes; no orbit:qa:score. */
export async function loginAsOrbitAgent(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.orbitAgent.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/** yusuf.karim@gonxt.ae — orbit.retention, holds orbit:renewals:update; owns the retention desk's renewal queue. */
export async function loginAsOrbitRetention(page: Page): Promise<void> {
  await goto(page, "/login");
  await page.getByRole("button", { name: new RegExp(PERSONAS.orbitRetention.name) }).click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}

/**
 * Say yes to the ask in front of a consequential action
 * (apps/web/app/components/confirm.tsx). It replaced `window.confirm()`, so
 * these clicks are ordinary DOM clicks, not `page.on("dialog")` acceptances.
 */
export async function confirmAction(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
}
