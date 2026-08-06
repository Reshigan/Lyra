import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./a11y.js";
import { goto, loginAsTenantAdmin } from "./fixtures.js";

/** Horizontal spill in CSS pixels. Sub-pixel rounding makes 1 the floor. */
async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

// @accept:M0-rtl (docs/IMPLEMENTATION.md §5): the web shell renders a
// pseudo-locale + RTL without layout break. Same lyra_locale cookie mechanism
// settings.tsx writes on a real locale change (apps/web/app/i18n.ts).
test.describe("pseudo-locale and RTL rendering", () => {
  test("pseudo-locale expands every string without breaking the login layout", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "lyra_locale", value: "pseudo", url: baseURL! }
    ]);
    await goto(page, "/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-x-pseudo");
    // Every pseudoized string is wrapped in ⟦…⟧ (apps/web/app/i18n.ts
    // pseudoize) — its presence proves the string went through the catalogue
    // rather than being a hardcoded literal that skipped translation.
    await expect(page.getByText(/⟦/).first()).toBeVisible();

    expect(
      await overflowOf(page),
      "pseudo-locale text overflowed the viewport width"
    ).toBeLessThanOrEqual(1);

    await expectNoA11yViolations(page);
    await page.screenshot({ path: "test-results/pseudo-locale-login.png", fullPage: true });
  });

  test("Arabic renders right-to-left without breaking the login layout", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "lyra_locale", value: "ar", url: baseURL! }]);
    await goto(page, "/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    expect(await overflowOf(page), "RTL layout overflowed the viewport width").toBeLessThanOrEqual(1);

    await expectNoA11yViolations(page);
    await page.screenshot({ path: "test-results/rtl-ar-login.png", fullPage: true });
  });

  // Login is the thinnest screen in the app: one card, a handful of strings.
  // Expanded text only collides where the layout is dense — a table header
  // row, a KPI wall, a nav rail beside a filter bar. ponytail: three
  // representative dense screens, not a crawl of every route.
  const DENSE = ["/", "/approvals", "/admin/customers"];

  for (const locale of ["pseudo", "ar"] as const) {
    test(`${locale} holds the dense workspace screens together`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      // Log in first: the persona buttons are matched by name, and the login
      // screen in a pseudo-locale is not the thing under test here.
      await loginAsTenantAdmin(page);
      await page.context().addCookies([{ name: "lyra_locale", value: locale, url: baseURL! }]);

      for (const path of DENSE) {
        await goto(page, path);
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          locale === "pseudo" ? "en-x-pseudo" : "ar"
        );
        if (locale === "pseudo") await expect(page.getByText(/⟦/).first()).toBeVisible();
        expect(await overflowOf(page), `${locale} text overflowed the viewport on ${path}`)
          .toBeLessThanOrEqual(1);
        await expectNoA11yViolations(page);
      }
    });
  }
});
