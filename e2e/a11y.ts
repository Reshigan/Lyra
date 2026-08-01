import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// CLAUDE.md WCAG 2.2 AA gate: real assertion, not a report — a violation
// fails the test. Run after the page is in the state you actually want
// scanned (post-navigation, post-fill, etc).
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}
