import { expect, test, type Locator, type Page } from "@playwright/test";
import { goto, loginAsAxisAgent, loginAsTenantAdmin } from "./fixtures.js";

// @journey:J-HERO-DRILLDOWN (apps/web/app/components/hero.tsx):
// The figure at the top of a screen is a door: clicking it shows exactly the
// rows it counted. These specs are the only place that claim is checked against
// a real database rather than a fixture — they read the number the tile printed,
// click it, and count what the screen then lists. A hero that says 412 and opens
// a list of 380 fails here, which is the whole reason the drill-down is a lens
// over one already-loaded array instead of a second query.

/** The integer a hero tile prints. Its label carries no digits, so stripping the
 *  non-digits off the tile leaves the figure whatever locale formatted it. */
async function figureIn(tile: Locator): Promise<number> {
  const text = await tile.innerText();
  return Number(text.replace(/\D/g, ""));
}

/** A hero tile that is a link — a figure with rows behind it. */
function tile(page: Page, label: RegExp): Locator {
  return page.getByRole("link").filter({ hasText: label }).first();
}

test("a document status figure opens exactly the documents it counted", async ({ page }) => {
  await loginAsTenantAdmin(page);
  await goto(page, "/axis/doc-intelligence");

  const unread = tile(page, /not read yet/i);
  const counted = await figureIn(unread);
  test.skip(counted === 0, "seed has no unread document to drill into");

  await unread.click();
  await expect(page).toHaveURL(/[?&]focus=received/);
  // Marked as the lens in play, so the reader knows why the list got shorter.
  await expect(tile(page, /not read yet/i)).toHaveAttribute("aria-current", "true");

  const list = page.getByRole("list", { name: /documents/i });
  await expect(list.getByRole("button")).toHaveCount(counted);

  // And the way back out returns the whole desk.
  const all = tile(page, /documents on the desk/i);
  const total = await figureIn(all);
  await all.click();
  await expect(list.getByRole("button")).toHaveCount(total);
});

test("the quote desk's silent-cases figure opens exactly those cases", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/axis/quote-desk");

  const silent = tile(page, /awaiting a first response/i);
  const counted = await figureIn(silent);
  test.skip(counted === 0, "seed has no case still awaiting a first response");

  await silent.click();
  await expect(page).toHaveURL(/[?&]focus=silent/);

  // One Card per case, titled with a link to the case itself.
  const cards = page.locator('section:has(header a[href^="/axis/cases/"])');
  await expect(cards).toHaveCount(counted);
});

test("the exceptions urgent figure opens exactly the urgent exceptions", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/axis/exceptions");

  const urgent = tile(page, /marked urgent/i);
  const counted = await figureIn(urgent);
  test.skip(counted === 0, "seed has no urgent exception");

  await urgent.click();
  await expect(page).toHaveURL(/[?&]focus=urgent/);

  // The urgent lens is cases only, so every listed row is a case row.
  await expect(page.locator('li:has(a[href^="/axis/cases/"])')).toHaveCount(counted);
});

test("a hero figure with no rows behind it is not a link", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/axis/exceptions");

  // "Oldest" is an age, not a set of rows: nothing to open, so it must not look
  // openable. docs/07 §3 — a door that was never there is absent, not disabled.
  await expect(page.getByRole("link").filter({ hasText: /^oldest/i })).toHaveCount(0);
});

test("the home approvals figure opens the queue holding that many items", async ({ page }) => {
  await loginAsAxisAgent(page);
  await goto(page, "/");

  const approvals = tile(page, /waiting on you/i);
  const counted = await figureIn(approvals);
  test.skip(counted === 0, "this actor has nothing waiting");

  await approvals.click();
  await expect(page).toHaveURL(/\/approvals/);
  // Both screens read /v1/me/inbox — the only actor-scoped endpoint — so the
  // queue holds the tile's own figure rather than the tenant's pending rows.
  await expect(page.getByRole("list", { name: /requests/i }).getByRole("listitem")).toHaveCount(
    counted
  );
});
