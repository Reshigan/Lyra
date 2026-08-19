import { expect, test } from "@playwright/test";
import { goto, loginAsScoutLead, loginAsNorthExec } from "./fixtures.js";

// @journey:J-P1 — where J-P1 radar quarterly is worked
// (docs/06-roles-and-journeys.md:73, docs/superpowers/specs/2026-08-16-scout-shell-fork-design.md):
// ScoutShell is its own scoped shell — an actor with a scout.*-resolving role
// lands in it and sees only SCOUT's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which scout.lead's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: scout-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("scout.lead lands in ScoutShell and sees only SCOUT's own rail", async ({ page }) => {
  await loginAsScoutLead(page);
  await goto(page, "/scout/radar");

  // scout-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching signal-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /radar/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /panel/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /pricing/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /experiments/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /analytics/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /data products/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /admin/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /dev/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /console/i })).toHaveCount(0);
});

test("an actor with no scout.*-resolving role gets 403, not 401, on /scout/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/scout/radar");
  expect(response?.status()).toBe(403);
});
