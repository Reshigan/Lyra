import { expect, test } from "@playwright/test";
import { goto } from "./fixtures.js";

// J-C4 "Exercise privacy rights" (docs/06-roles-and-journeys.md): the data
// subject lodges the request themselves from the public site — no session, no
// staff intermediary — and leaves with a reference and a date. ADR-0042
// supersedes ADR-0041's staff-mediated intake.
//
// Fulfilment stays staff-side on purpose: nothing is packaged or erased until
// a human verifies the subject, because docs/12 names no verification method
// and `IdentityVerifier` (packages/core seams, H5) has no implementation. What
// this spec proves is the door: findable, submittable, and answered.

test("J-C4 a data subject lodges an access request from the public portal @journey:J-C4 @accept:M6", async ({
  page
}) => {
  await goto(page, "/portal/gonxt");

  // The right is theoretical if the door is not reachable from the storefront.
  await page.getByRole("link", { name: "Your privacy rights" }).click();

  await expect(page.getByRole("heading", { name: "Your privacy rights", level: 1 })).toBeVisible();

  await page.getByRole("radio", { name: "Delete my data" }).check();
  await page.getByLabel("Email address you deal with us on").fill(`jc4-${Date.now()}@example.com`);
  await page.getByLabel("Full name (optional)").fill("E2E Subject");
  await page
    .getByLabel("Anything that helps us find your records, or what needs correcting (optional)")
    .fill("Please erase everything you hold about me.");
  await page.getByRole("button", { name: "Send request" }).click();

  // A reference and a date, not a promise: the subject can chase this.
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
  await expect(page.getByText(/^dsr_/)).toBeVisible();
});

test("J-C4 the portal will not confirm whether an address is a customer @journey:J-C4 @accept:M6", async ({
  page
}) => {
  // Same page, an address that is certainly not on file. The subject must see
  // exactly what a known customer sees, or the public form becomes a
  // customer-enumeration oracle.
  await goto(page, "/portal/gonxt/privacy");
  await page.getByLabel("Email address you deal with us on").fill(`nobody-${Date.now()}@example.invalid`);
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
  await expect(page.getByText(/not found|no record|unknown/i)).toHaveCount(0);
});
