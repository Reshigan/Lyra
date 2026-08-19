import { expect, test } from "@playwright/test";
import { goto } from "./fixtures.js";

// J-C1 "Get covered" (docs/06-roles-and-journeys.md), customer half: land, answer
// three things, see ranked offers, choose one, send documents. No session at any
// point — the one-time token in the URL is the whole credential (ADR-0043).
//
// The journey's payment step is deliberately absent: no PSP is contracted
// (docs/02 §9) and binding cover is `consequential: true`, so the last thing the
// visitor does is hand over documents and a human issues.

test("J-C1 a visitor prices the panel and picks an offer without signing in @journey:J-C1 @accept:M6", async ({
  page
}) => {
  await goto(page, "/portal/gonxt");

  const motor = page.getByRole("region", { name: "Motor comprehensive" });
  await motor.getByText("Get a quote").click();

  await motor.getByLabel("Your age").fill("34");
  await motor.getByLabel("Value to insure").fill("280000");
  await motor.getByLabel("Full name").fill("E2E Visitor");
  await motor.getByLabel("Email").fill(`jc1-${Date.now()}@example.com`);
  await motor.getByLabel("I agree to be contacted about this quote.").check();
  await motor.getByRole("button", { name: "Request quote" }).click();

  // Priced in session, not "we'll call you".
  await expect(page.getByRole("heading", { name: "Your quotes", level: 1 })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("token")).toMatch(/^[0-9a-f]{48}$/);

  // Declared criteria visible — the journey is written against a comparison
  // that hides how it sorted.
  await expect(page.getByText("Ranked by total price, cheapest first.")).toBeVisible();
  await expect(page.getByText("Cheapest", { exact: true })).toBeVisible();

  // The comparison is row-wise — one row per criterion, one column per offer —
  // so an offer is a column header, not a card in a list. Only the offer `th`s
  // are `scope="col"`; the row labels are `scope="row"` and read as rowheaders.
  expect(await page.getByRole("columnheader").count()).toBeGreaterThan(1);

  // Nothing the back office keeps to itself leaks onto a public page.
  await expect(page.getByText(/commission|value score|declined because/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Choose this cover" }).first().click();

  // Accepting converts the request; it does not bind cover or take money.
  await expect(page.getByRole("heading", { name: "Next: send your documents" })).toBeVisible();
  await expect(page.getByText("Nothing is bound yet.", { exact: false })).toBeVisible();
  await expect(page.getByText("Chosen")).toBeVisible();

  await page.getByLabel(/^Document /).setInputFiles({
    name: "id.png",
    mimeType: "image/png",
    // 1x1 PNG; the endpoint checks the declared type and the size cap, and the
    // point here is that the round trip stores something.
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    )
  });
  await page.getByRole("button", { name: "Upload document" }).click();

  await expect(page.getByText("Received. Upload another if you have one.")).toBeVisible();
});

test("J-C1 the comparison is unreachable without the token @journey:J-C1 @accept:M6", async ({ page }) => {
  // Same page, same tenant, no credential. A quote is a stranger's personal
  // data; guessing an id must not be enough to read it.
  const response = await page.goto("/portal/gonxt/quotes/dqr_00000000000000000000000000?token=", {
    waitUntil: "domcontentloaded"
  });
  expect(response?.status()).toBe(404);
});
