import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./a11y.js";

// @accept:M0-rtl (docs/IMPLEMENTATION.md §5): the web shell renders a
// pseudo-locale + RTL without layout break. Same lyra_locale cookie mechanism
// settings.tsx writes on a real locale change (apps/web/app/i18n.ts).
test.describe("pseudo-locale and RTL rendering", () => {
  test("pseudo-locale expands every string without breaking the login layout", async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "lyra_locale", value: "pseudo", url: baseURL! }
    ]);
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-x-pseudo");
    // Every pseudoized string is wrapped in ⟦…⟧ (apps/web/app/i18n.ts
    // pseudoize) — its presence proves the string went through the catalogue
    // rather than being a hardcoded literal that skipped translation.
    await expect(page.getByText(/⟦/).first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "pseudo-locale text overflowed the viewport width").toBeLessThanOrEqual(1);

    await expectNoA11yViolations(page);
    await page.screenshot({ path: "test-results/pseudo-locale-login.png", fullPage: true });
  });

  test("Arabic renders right-to-left without breaking the login layout", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "lyra_locale", value: "ar", url: baseURL! }]);
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, "RTL layout overflowed the viewport width").toBeLessThanOrEqual(1);

    await expectNoA11yViolations(page);
    await page.screenshot({ path: "test-results/rtl-ar-login.png", fullPage: true });
  });
});
