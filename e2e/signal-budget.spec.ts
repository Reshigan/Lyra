import { expect, test } from "@playwright/test";
import { loginAsSignalLead } from "./fixtures.js";

// J-M2 "budget morning" (docs/06-roles-and-journeys.md): "approve/undo
// autopilot moves from mobile in 2 min". The web UI has no separate
// create/approve action distinct from a reversal — signal.budget_move is
// single control (packages/core/src/approvals.ts) and every move the
// autopilot makes is either accepted as-is or reversed via the one editable
// action (apps/web/app/modules/signal.ts:396-399: reversedBy/reversedAt).
// This spec covers the real, full round trip (apps/api/src/journeys.test.ts
// :858-883): the first attempt is refused (approval_required), the same
// signal lead decides it via /approvals (single control has no self-decide
// gate — dualControl "never"), and the retry then succeeds. "From mobile"
// and "2 min" are not testable properties of this stack and are not asserted.
test("J-M2 signal lead reverses an autopilot budget move", async ({ page }) => {
  await loginAsSignalLead(page);

  // Seeded, unreversed, uniquely-worded move (packages/core/src/seed/signal.ts).
  // budget-moves has no `searchable` columns (apps/api/src/resources.ts:300-303),
  // so `?q=` is rejected with 400 — the full, unfiltered list (well under the
  // default page size of 50) is located by row text instead.
  await page.goto("/signal/budget-moves");
  const row = page.getByRole("row", { name: new RegExp("Bing's cost per policy") });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  // Client-side <Link> navigation (pushState, no full load) — wait for the
  // URL to actually change before reading it, or this races the router.
  await page.waitForURL(/\/signal\/budget-moves\/.+/);
  const recordUrl = page.url();
  const moveId = recordUrl.split("/").pop()!;

  await page.getByLabel("Reversed by", { exact: true }).fill("noor.jamal@gonxt.ae");
  await page.getByLabel("Reversed", { exact: true }).fill("2026-08-01T09:00");
  await page.getByRole("button", { name: "Save changes" }).click();

  // Refused: record.tsx's shared Problem box renders the policy key as the
  // detail (packages/core/src/errors.ts's approvalRequired(policyKey, ...)).
  await expect(page.getByRole("alert")).toHaveText("signal.budget_move");

  // Single control, no self-decide gate — the same signal lead approves.
  // Seed data already carries a second, unrelated pending signal.budget_move
  // request (packages/core/src/seed/signal.ts:928-945), so every
  // "signal.budget_move" region is scoped by its subject — the move's own row
  // id, rendered as the card's description/subject link text.
  await page.goto("/approvals");
  const request = page.getByRole("region", { name: "signal.budget_move" }).filter({ hasText: moveId });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  // The decided row drops out of the pending list on revalidation
  // (approvals.tsx's loader re-fetches /v1/me/inbox); the outcome is the
  // page-level status announcement, not a badge inside a now-vanished region.
  await expect(page.getByRole("status")).toHaveText("Approved. The action may now proceed.");

  // Retry the same edit; it now goes through.
  await page.goto(recordUrl);
  await page.getByLabel("Reversed by", { exact: true }).fill("noor.jamal@gonxt.ae");
  await page.getByLabel("Reversed", { exact: true }).fill("2026-08-01T09:00");
  // .click() only waits for the click event, not the Form's async action/
  // revalidation — an immediately-following goto races the in-flight fetch
  // and can read back the pre-write page. Wait for the POST response itself
  // (React Router v7's client fetcher posts to "<path>.data", not the bare path).
  await Promise.all([
    page.waitForResponse((res) => res.url() === `${recordUrl}.data` && res.request().method() === "POST"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);

  // reversedBy/reversedAt are editable-only fields (apps/web/app/modules
  // /signal.ts:396-399), never in `columns` — record.tsx's dl only renders
  // `columns` (record.tsx:153-172), so the dl can never show this value.
  // FieldInput's inputs are uncontrolled (defaultValue, fields.tsx:176) — a
  // fresh navigation is required for the loader's persisted row to reach it.
  await page.goto(recordUrl);
  await expect(page.getByLabel("Reversed by", { exact: true })).toHaveValue("noor.jamal@gonxt.ae");
});
