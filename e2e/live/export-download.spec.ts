import { expect, test } from "@playwright/test";
import { PERSONAS } from "../env.js";
import { signIn } from "./sign-in.js";

// The download links on the finance and analytics screens point straight at the
// API host (apps/web/app/routes/ledger-reports.tsx), which only works while the
// session cookie is scoped to the parent domain both hosts share — apps/api's
// SESSION_COOKIE_DOMAIN. A host-only cookie makes every one of them 401 while
// the screen around them still renders perfectly, so nothing but a real fetch
// on a real deployment catches it. `pnpm e2e` cannot: there web and api are the
// same host.
//
// Read-only, like the rest of e2e/live: a report export is a GET.

test("a direct-to-API export link answers with the file, not a 401", async ({ page, context }) => {
  await signIn(page, PERSONAS.financeController);
  await page.goto("/ledger/reports/trial-balance");

  const link = page.getByRole("link", { name: /csv/i }).first();
  await expect(link, "the trial balance offers no download link").toBeVisible();
  const href = await link.getAttribute("href");
  expect(href, "the download link has no href").toBeTruthy();

  // The API's own origin, not the app's — that is the whole point of the check.
  const url = new URL(href as string, page.url());
  expect(url.host, `the link points at the app host (${url.host}), so it proves nothing`).not.toBe(
    new URL(page.url()).host
  );

  // context.request shares the browser's cookie jar, so this is the request the
  // anchor would make. A 401 here is the session cookie not reaching the API.
  const response = await context.request.get(url.toString());
  expect(response.status(), `GET ${url.pathname} answered ${response.status()}`).toBe(200);
  expect((await response.body()).byteLength).toBeGreaterThan(0);
});
