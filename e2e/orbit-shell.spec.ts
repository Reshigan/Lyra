import { expect, test } from "@playwright/test";
import { goto, loginAsOrbitAgent, loginAsNorthExec } from "./fixtures.js";

// @journey:J-ORBIT-SHELL (docs/superpowers/specs/2026-08-16-orbit-shell-fork-design.md):
// OrbitShell is its own scoped shell — an actor with an orbit.*-resolving role
// lands in it and sees only ORBIT's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which orbit.agent's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: orbit-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("orbit.agent lands in OrbitShell and sees only ORBIT's own rail", async ({ page }) => {
  await loginAsOrbitAgent(page);
  await goto(page, "/orbit/console");

  // orbit-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching axis-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /console/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /supervisor/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /save desk/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /pipeline/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /quality/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /analytics/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /admin/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /dev/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /exceptions/i })).toHaveCount(0);
});

test("an actor with no orbit.*-resolving role gets 403, not 401, on /orbit/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/orbit/console");
  expect(response?.status()).toBe(403);
});
