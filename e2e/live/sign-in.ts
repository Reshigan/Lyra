import { expect, type Page } from "@playwright/test";

/**
 * The demo door on a deployed build. Shared by every spec under e2e/live so
 * that a change to the login screen breaks in one place rather than in each.
 */
export async function signIn(page: Page, persona: { name: string }): Promise<void> {
  await page.goto("/login");
  await page.waitForFunction(() => "__reactRouterDataRouter" in window);
  // The demo wall has had two shapes: an always-open <section> above the form,
  // and the current closed <details> below it. A deployment can be running
  // either, so open the collapsed one if that is what is there and otherwise
  // go straight for the button.
  const collapsed = page.getByRole("group").filter({ hasText: "Demo sign-in" });
  if (await collapsed.count()) {
    if (!(await collapsed.first().evaluate((el) => (el as HTMLDetailsElement).open))) {
      await page.getByText("Demo sign-in", { exact: true }).click();
    }
  }
  const door = page.getByRole("button", { name: new RegExp(persona.name) });
  await expect(door, "the deployment offers no demo door — is this a demo build?").toBeVisible();
  await door.click();
  await page.waitForURL(/^https?:\/\/[^/]+\/$/);
}
