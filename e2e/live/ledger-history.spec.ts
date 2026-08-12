import { expect, test } from "@playwright/test";
import { PERSONAS } from "../env.js";
import { signIn } from "./sign-in.js";

// The deployed tenants carry four months of backfilled trading history
// (packages/core/src/seed/history.ts). Read-only, like the rest of e2e/live.
//
// The seed's own unit tests prove the postings balance; this proves the finance
// screens survive the volume — a ledger that renders eighteen fixture rows says
// nothing about one holding hundreds, and an unbounded query or an un-paged
// table only fails once there is a book to fail on.

const FINANCE_SCREENS = [
  "/ledger/transactions",
  "/ledger/statement",
  "/ledger/period-close",
  "/ledger/reports/trial-balance"
];

test.describe("the deployed ledger", () => {
  test("the finance screens render against the backfilled book", async ({ page }) => {
    await signIn(page, PERSONAS.financeController);

    for (const path of FINANCE_SCREENS) {
      await page.goto(path);
      await expect(page.getByRole("main"), `${path} rendered no content`).toBeVisible();
      // An error boundary is the shape a blown query takes on a deployed build —
      // the route still responds 200 and still has a <main>.
      await expect(page.getByRole("main")).not.toContainText(/Something went wrong|Unexpected error/i);
    }
  });

  test("the transaction list shows more than the fixture book", async ({ page }) => {
    await signIn(page, PERSONAS.financeController);
    await page.goto("/ledger/transactions");
    const rows = page.getByRole("row");
    // 18 rows is the pre-backfill fixture count; anything at or below it means
    // the history never reached this environment.
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(18);
  });
});
