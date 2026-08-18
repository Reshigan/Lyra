import { expect, test } from "@playwright/test";
import { goto, loginAsSignalLead, loginAsNorthExec } from "./fixtures.js";

// @journey:J-SIGNAL-SHELL (docs/superpowers/specs/2026-08-16-signal-shell-fork-design.md):
// SignalShell is its own scoped shell — an actor with a signal.*-resolving
// role lands in it and sees only SIGNAL's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which signal.lead's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: signal-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("signal.lead lands in SignalShell and sees only SIGNAL's own rail", async ({ page }) => {
  await loginAsSignalLead(page);
  await goto(page, "/signal/cockpit");

  // signal-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching orbit-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /cockpit/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /studio/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /audiences/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /aeo/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /experiments/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /budget/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /analytics/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /admin/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /dev/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /console/i })).toHaveCount(0);
});

test("an actor with no signal.*-resolving role gets 403, not 401, on /signal/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/signal/cockpit");
  expect(response?.status()).toBe(403);
});
