import { expect, test, type Page } from "@playwright/test";
import { confirmAction, goto, loginAsAxisAgent, loginAsAxisLead, loginAsFinanceController, loginAsTenantAdmin } from "./fixtures.js";

// packages/ui/src/primitives.tsx's Select has no scroll-button affordance, so
// any option outside the current viewport (a long catalogue, or one on the
// far side of the popup's auto-scroll-to-current-value on open) can't be
// reached by a plain click. Radix's own keyboard typeahead jumps straight to
// it instead — but only once the popup has actually mounted; typing before
// then loses keystrokes, so wait for the listbox before typing, and confirm
// the highlighted option before committing with Enter rather than trust a
// fixed number of keystrokes to land correctly.
async function selectByTypeahead(page: Page, label: string, optionText: string) {
  const trigger = page.getByLabel(label, { exact: true });
  const listbox = page.getByRole("listbox");
  const highlighted = page.locator('[role="option"][data-highlighted]');
  // Re-opening a Select shortly after the previous form's "Save changes"
  // click/navigation can race a stray event that closes the popup again —
  // sometimes right after opening, sometimes mid-typeahead (confirmed
  // empirically: the listbox can toggle visible → hidden on its own on a
  // fraction of runs, at either point). Retry the whole open-type-confirm
  // sequence until the option is actually highlighted and stays put, rather
  // than trust any single attempt.
  for (let attempt = 0; attempt < 5; attempt++) {
    await trigger.click({ timeout: 3000 }).catch(() => {});
    await listbox.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    if (!(await listbox.isVisible().catch(() => false))) continue;
    await page.keyboard.type(optionText, { delay: 30 });
    if (await highlighted.filter({ hasText: optionText }).isVisible({ timeout: 1000 }).catch(() => false)) break;
  }
  await expect(highlighted).toHaveText(optionText);
  await page.keyboard.press("Enter");
}

// J-O1 "Exception clearing" (docs/06-roles-and-journeys.md §Ops (AXIS)): an
// axis.agent opens the exceptions queue — AXIS cases filtered to
// status=failed — and clears one by moving it off "failed". The queue drops
// it immediately, no separate refresh step.
test("J-O1 axis agent filters the exceptions queue and clears a failed case", async ({ page }) => {
  await loginAsAxisAgent(page);

  await goto(page, "/axis/cases");
  const ref = `J-O1-${Date.now()}`;
  await page.getByText("New — Cases").click();
  await page.getByLabel("Reference*", { exact: true }).fill(ref);
  await page.getByLabel("Kind*", { exact: true }).click();
  await page.getByRole("option", { name: "Quote", exact: true }).click();
  // The click resolves as soon as the event fires, not once the submission
  // completes; navigating away immediately (below) cancels the in-flight
  // request. `waitForLoadState("networkidle")` cannot cover this — a hydrated
  // <Form> posts via fetch, no navigation happens, and the load state was
  // already reached, so it returns instantly. Wait for the POST itself
  // (React Router posts to "<path>.data").
  await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/axis/cases.data") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Create", exact: true }).click()
  ]);

  // Scope by search rather than trusting the fresh row to land on the
  // unfiltered list's first (unpaginated) page — the case list sorts oldest
  // first with no filter applied here, so accumulated data can push a brand
  // new row past the page size.
  await goto(page, `/axis/cases?q=${encodeURIComponent(ref)}`);
  const row = page.getByRole("row", { name: new RegExp(ref) });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: ref }).click();
  await page.waitForURL(/\/axis\/cases\//);

  // Push the fresh case into the exception state.
  await selectByTypeahead(page, "Status", "Failed");
  await page.getByRole("button", { name: "Save changes" }).click();
  // The record view has no separate "saved" toast for a plain field edit
  // (record.tsx's `done` banner only fires for declared actions) — the
  // read-only definition list re-rendering with the new value is the
  // confirmation. Scoped to <dl>: "Failed" also matches the edit-form
  // Select's own trigger text and its hidden native <option>.
  await expect(page.locator("dl").getByText("Failed", { exact: true })).toBeVisible();

  // The exceptions queue: only failed items.
  await goto(page, `/axis/cases?status=failed&q=${encodeURIComponent(ref)}`);
  await expect(page.getByRole("row", { name: new RegExp(ref) })).toBeVisible();

  // Clear it — move the status off "failed" — and the queue drops it.
  await page.getByRole("row", { name: new RegExp(ref) }).getByRole("link", { name: ref }).click();
  await selectByTypeahead(page, "Status", "Quoting");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("dl").getByText("Quoting", { exact: true })).toBeVisible();

  await goto(page, `/axis/cases?status=failed&q=${encodeURIComponent(ref)}`);
  await expect(page.getByRole("row", { name: new RegExp(ref) })).toHaveCount(0);
});

// J-O3 "Month-end recon" (docs/06-roles-and-journeys.md §Ops (AXIS)): a
// finance.controller imports counterparty statement lines, the engine
// auto-matches them against settled transactions, and what is left is an
// exception a person decides — with a reason recorded against the decision.
test("J-O3 finance controller runs a reconciliation and decides an exception with a reason", async ({
  page
}) => {
  await loginAsFinanceController(page);

  // Settle one transaction so the recon engine has something to match against.
  const naturalKey = `j-o3-${Date.now()}`;
  await goto(page, "/ledger/transactions");
  await selectByTypeahead(page, "Transaction type*", "CM-RECEIPT");
  await page.getByLabel("Transaction key*", { exact: true }).fill(naturalKey);
  await page.getByLabel("Currency", { exact: true }).fill("AED");
  await page.getByLabel("Gross amount, in minor units", { exact: true }).fill("500000");
  // The generic `grossMinor`/`currency` fields above are the ledger envelope;
  // CM-RECEIPT's own recipe (packages/ledger/src/recipes.ts ClientMoneyArgs)
  // separately requires `amountMinor` inside the free-form Arguments JSON.
  await page.getByLabel("Arguments", { exact: true }).fill(JSON.stringify({ amountMinor: 500000 }));
  await page.getByRole("button", { name: "Open transaction" }).click();
  await confirmAction(page);
  await expect(page.getByText(/Opened as/)).toBeVisible();

  // Import a statement line that references it, off by an amount the
  // insurer-process tolerance absorbs — an auto-match, not an exact one.
  await goto(page, "/ledger/recon");
  const statementRef = `STMT-${Date.now()}`;
  const lines = JSON.stringify([
    { ref: statementRef, amountMinor: 500050, currency: "AED", ourRef: naturalKey }
  ]);
  await page.getByLabel("Statement lines*", { exact: true }).fill(lines);
  await page.getByRole("button", { name: "Start run" }).click();
  await confirmAction(page);
  await expect(page.getByText(/started/)).toBeVisible();

  await page.getByRole("link", { name: "Run", exact: true }).click();

  // A tolerance match is auto-proposed, never auto-confirmed — it is the
  // exception a person still has to decide, with a reason recorded.
  const matchRow = page.getByRole("row", { name: new RegExp(statementRef) });
  await expect(matchRow).toBeVisible();
  await expect(matchRow.getByText("Within tolerance")).toBeVisible();
  await expect(matchRow.getByText("Proposed")).toBeVisible();

  await matchRow.getByLabel("Why", { exact: true }).fill("Matches bank feed for this period");
  await matchRow.getByRole("button", { name: "Confirm", exact: true }).click();
  await confirmAction(page);

  await expect(page.getByText(/Match recorded as Confirmed/)).toBeVisible();
  await expect(matchRow.getByText("Confirmed")).toBeVisible();
});

// J-O2 "Group medical bid" (docs/06-roles-and-journeys.md §Ops (AXIS)): an
// axis.lead shops a fresh risk to the panel and the comparison answers with
// referrals, never silence (apps/api/src/journeys.test.ts covers the API
// side; this proves the same path through the actual UI).
test("J-O2 axis lead shops a new risk and the panel answers", async ({ page }) => {
  // Seed IDs are ULIDs assigned at run time (packages/db/src/ids.ts), so the
  // real productId/channelId can't be computed — look them up once. axis.lead
  // has no core:products:read, so tenant.admin (core:*:* + dist:*:read) does
  // the one-time lookup instead.
  await loginAsTenantAdmin(page);

  await goto(page, "/admin/products?line=health");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.waitForURL(/\/admin\/products\/.+/);
  const productId = page.url().split("/").pop()!;

  await goto(page, "/distribution/channels?q=alpha-brokers");
  const channelRow = page.getByRole("row", { name: /alpha-brokers/ });
  await expect(channelRow).toBeVisible();
  await channelRow.getByRole("link", { name: "alpha-brokers" }).click();
  await page.waitForURL(/\/distribution\/channels\/.+/);
  const channelId = page.url().split("/").pop()!;

  await loginAsAxisLead(page);

  // No customerId here: the reshop action re-forwards it, and a customer with
  // no matching consentId trips the docs/12 §3 consent gate on reshop. This
  // journey is about an anonymous risk shopped cold, so leave it unset.
  await goto(page, "/distribution/quote-requests");
  await page.getByText("New — Quote requests").click();
  await page.getByLabel("Channel*", { exact: true }).fill(channelId);
  await page.getByLabel("Product*", { exact: true }).fill(productId);
  await page
    .getByLabel("Risk details*", { exact: true })
    .fill(JSON.stringify({ age: 41, sumInsuredMinor: 10_000_000, priorClaims: false, lives: 120 }));
  await page.getByLabel("Currency*", { exact: true }).fill("AED");
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith("/distribution/quote-requests.data") && res.request().method() === "POST"
    ),
    page.getByRole("button", { name: "Create", exact: true }).click()
  ]);

  // quote-requests has no `q` search. The seed's one quote-request is already
  // fully answered (packages/core/src/seed.ts), so `state=open` is exactly
  // the freshly-created row.
  await goto(page, "/distribution/quote-requests?state=open");
  const row = page.getByRole("row").filter({ hasText: "Open" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  await page.waitForURL(/\/distribution\/quote-requests\/.+/);
  const quoteRequestId = page.url().split("/").pop();
  await goto(page, `/distribution/quote-requests/${quoteRequestId}/compare`);

  // Freshly opened: nothing has answered yet.
  await expect(page.getByText("The panel was never asked")).toBeVisible();
  await expect(
    page.getByText("This request has no responses at all, not even a decline. Re-shop it to send the requirement out.")
  ).toBeVisible();

  await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/compare.data") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Re-shop the panel" }).click()
  ]);

  // A referral panel answers with referrals, not silence. This seed panel's
  // one provider declines with a reason rather than a price (apps/api/src
  // /routes/dist.ts only puts state==="quoted" responses in `quotes`, which
  // is where the Commission column lives — a referral never carries one).
  await expect(page.getByText(/Referred|Quoted/).first()).toBeVisible();
  await expect(page.getByText("Did not quote", { exact: true })).toBeVisible();
});
