import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "../a11y.js";
import { PERSONAS } from "../env.js";
import { signIn } from "./sign-in.js";

// A read-only pass over the deployed site (playwright.live.config.ts). The
// journey suite owns behaviour against a seeded local stack; this one answers
// a different question — "is what we shipped actually what a demo user sees?"
// Nothing here writes: no form is submitted beyond the demo door, so it is
// safe to point at lyra.vantax.co.za.

/** Screens every persona can reach, whatever their role. */
const SHARED_SCREENS = ["/", "/approvals", "/settings"];

/**
 * Words that mean the label chain broke: a raw i18n key, a raw enum value, or
 * a namespaced key printed at the user (docs/ui.md §7 P3-14). The web suite's
 * labels.shared.test.ts guards the source; this catches what reaches a screen.
 */
const RAW_KEY = /(?:^|\s)(?:common|status|state|outcome|tier|severity|autonomy|agentStatus)\.[a-z_]+/;
const RAW_CAMEL = /(?:^|\s)(?:approvalTitle|approvalBody|approvalLink)(?:$|\s)/;

test.describe("the deployed site", () => {
  test("the login screen has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/login");
    await expectNoA11yViolations(page);
  });

  for (const [key, persona] of Object.entries(PERSONAS)) {
    test(`${key} signs in and reads real words on every shared screen`, async ({ page }) => {
      await signIn(page, persona);
      // Seeded personas carry their own locale — Khalid Al Rashed's workspace
      // comes back in Arabic, so the rail's accessible name is not "Primary".
      await expect(page.getByRole("navigation", { name: /Primary|التنقل الرئيسي/ })).toBeVisible();

      for (const path of SHARED_SCREENS) {
        await page.goto(path);
        await page.waitForFunction(() => "__reactRouterDataRouter" in window);
        const main = page.getByRole("main");
        await expect(main, `${path} rendered nothing`).toBeVisible();
        const text = (await main.innerText()).trim();
        expect(text.length, `${path} is blank`).toBeGreaterThan(0);
        expect(text, `${path} printed a raw label key`).not.toMatch(RAW_KEY);
        expect(text, `${path} printed a raw label key`).not.toMatch(RAW_CAMEL);
        // A 500 renders the error boundary, which is a <main> with copy in it.
        expect(text).not.toMatch(/Something went wrong|Unexpected Server Error/i);
      }
    });
  }

  test("the home workspace has no WCAG 2.2 AA violations", async ({ page }) => {
    await signIn(page, PERSONAS.tenantAdmin);
    await expectNoA11yViolations(page);
  });
});
