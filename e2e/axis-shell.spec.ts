import { expect, test } from "@playwright/test";
import { goto, loginAsAxisAgent, loginAsNorthExec } from "./fixtures.js";

// @journey:J-AXIS-SHELL (docs/superpowers/specs/2026-08-16-axis-shell-fork-design.md):
// AxisShell is its own scoped shell — an actor with an axis.*-resolving role
// lands in it and sees only AXIS's own rail (never another module's,
// ModuleSwitcher only appears once an actor's roles resolve to more than one
// shell, which axis.agent's single role never does), and an actor without one
// gets 403 (not 401 — bootstrapSession already proved who they are, they are
// just not entitled to this shell: axis-shell.tsx's loader). No Meridian —
// ADR-0061 is explicit that Meridian is NORTH-only.

test("axis.agent lands in AxisShell and sees only AXIS's own rail", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/axis/board");

  // axis-shell.tsx renders two <nav aria-label="Primary"> landmarks (one
  // md:hidden for mobile, one hidden md:flex for desktop); Playwright's
  // default chromium viewport is desktop-sized, so the mobile one is
  // display:none and getByRole already excludes it from the a11y tree —
  // .first() is defensive, matching north-shell.spec.ts's convention.
  const rail = page.getByRole("navigation", { name: /primary/i }).first();

  await expect(rail.getByRole("link", { name: /exceptions/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /board/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /quote desk/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /renewals/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /referrals/i })).toBeVisible();
  await expect(rail.getByRole("link", { name: /claims desk/i })).toBeVisible();

  // No other module's destinations leak into this rail.
  await expect(rail.getByRole("link", { name: /^brief$/i })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /explorer/i })).toHaveCount(0);
});

test("an actor with no axis.*-resolving role gets 403, not 401, on /axis/*", async ({ page }) => {
  await loginAsNorthExec(page);
  const response = await page.goto("/axis/board");
  expect(response?.status()).toBe(403);
});
