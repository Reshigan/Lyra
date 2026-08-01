import { expect, test } from "@playwright/test";
import { loginAsComplianceOfficer, loginAsScoutLead, loginAsSignalLead } from "./fixtures.js";

// J-M1 "campaign in a day" (docs/06-roles-and-journeys.md:66-67): "brief -> 20
// ar/en variants -> compliance lane -> publish -> cockpit shows CAC by
// evening." The acceptance test this journey actually has
// (apps/api/src/journeys.test.ts:808-851) is three `it`s, none of which touch
// creatives at all:
//
//   1. a growth lead authors an audience and a draft campaign.
//   2. going live is auto-approved by *this* tenant's policy
//      (packages/core/src/seed.ts:154, `autoApprove: ["signal.campaign_launch"]`)
//      but still writes to the audit log.
//   3. a marketer without the launch permission is refused.
//
// The docs' "20 ar/en variants" and "compliance lane" have no UI behind them
// in this acceptance test's real scope: signal:creatives has a create form
// (apps/web/app/modules/signal.ts) but authoring 20 localized variants in one
// action is not a real affordance (one row per submit, no bulk-generate
// button), and "compliance lane" — a creative's complianceStatus edit — is
// gated on a *different* permission (signal:creatives:approve) that this test
// never exercises. Per CLAUDE.md's TDD rule, the test matches the
// journeys.test.ts scope, not the docs' aspirational prose; creatives are not
// touched here.
//
// Two further, real gaps in what the UI can reach:
//   - The campaign create form's `objective` select only offers
//     ["acq", "renewal", "xsell"] (signal.ts:274-279) — the acceptance test's
//     own objective, "retention", is not one of them (the API's column has no
//     enum constraint, so the test can type anything; the UI cannot). "renewal"
//     is used here as the nearest of the three real options.
//   - `it 3`'s actor is `scout.lead`, who holds zero `signal:*` permissions at
//     all (packages/core/src/rbac.ts) — not just the launch permission. A UI
//     visit to any `/signal/campaigns` URL is refused by the *read* permission
//     before a launch is ever attempted, which is a superset of the API test's
//     specific PATCH-is-403 assertion, not a narrower one.
test("J-M1 a growth lead authors an audience and campaign, then launches it (auto-approved, audited)", async ({
  page
}) => {
  await loginAsSignalLead(page);

  const suffix = Date.now();
  const audienceName = `Motor renewals, 30 days ${suffix}`;

  // audiences has no `searchable` columns (apps/api/src/resources.ts) — `?q=`
  // is rejected with 400 — so the fresh row is located by its unique name in
  // the unfiltered (well under page-size) list, same as save-desk/scout-
  // whitespace/signal-budget do for their own non-searchable resources.
  await page.goto("/signal/audiences");
  await page.getByText("New — Audiences").click();
  await page.getByLabel("Name*", { exact: true }).fill(audienceName);
  await page
    .getByLabel("Definition*", { exact: true })
    .fill(JSON.stringify({ segment: "renewals", withinDays: 30 }));
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const audienceRow = page.getByRole("row", { name: new RegExp(audienceName) });
  await expect(audienceRow).toBeVisible();
  await audienceRow.getByRole("link").first().click();
  // Client-side <Link> navigation (pushState, no full load) — wait for the URL
  // to actually change before reading it, or this races the router.
  await page.waitForURL(/\/signal\/audiences\/.+/);
  const audienceId = page.url().split("/").pop()!;

  const campaignName = `Renewal save ${suffix}`;

  // campaigns *is* searchable (resources.ts: searchable: ["name"]), so the
  // fresh row is located with `?q=` instead of scanning an unfiltered list.
  await page.goto("/signal/campaigns");
  await page.getByText("New — Campaigns").click();
  await page.getByLabel("Name*", { exact: true }).fill(campaignName);
  // Objective is a Radix combobox (packages/ui/src/primitives.tsx Select), not
  // a native <select> — selectOption doesn't apply. Its listbox repositions
  // after Playwright's pre-click stability check, so open+select is retried as
  // a unit under load (same idiom as scout-whitespace.spec.ts).
  await expect(async () => {
    await page.getByLabel("Objective*", { exact: true }).click();
    await page.getByRole("option", { name: "Renewal", exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByLabel("Audience", { exact: true }).fill(audienceId);
  await page.getByLabel("Channels*", { exact: true }).fill(JSON.stringify(["email", "whatsapp"]));
  await page.getByLabel("Budget*", { exact: true }).fill(JSON.stringify({ dailyMinor: 50_000 }));
  await page.getByLabel("Owner*", { exact: true }).fill("noor.jamal@gonxt.ae");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const campaignRow = page.getByRole("row", { name: new RegExp(campaignName) });
  await expect(campaignRow).toBeVisible();
  await campaignRow.getByRole("link").first().click();
  await page.waitForURL(/\/signal\/campaigns\/.+/);
  const recordUrl = page.url();
  const campaignId = recordUrl.split("/").pop()!;

  // Defaulted server-side (schema.campaigns.state.default("draft")), never
  // typed into the create form (state is editable-only, signal.ts:284-292).
  await expect(page.locator("dl").getByText("Draft", { exact: true })).toBeVisible();

  // Going live: signal.campaign_launch sits on this tenant's auto_approve
  // allowlist, so gate() clears the write immediately — no trip through
  // /approvals — but crud.ts's update handler audits every write regardless.
  await expect(async () => {
    await page.getByLabel("State", { exact: true }).click();
    await page.getByRole("option", { name: "Live", exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // record.tsx's edit <Form> submit only waits for the click event, not the
  // async action/revalidation — React Router v7's client fetcher posts to
  // "<path>.data" (not the bare path); wait for that response before reading
  // persisted state back, exactly as signal-budget.spec.ts does.
  await Promise.all([
    page.waitForResponse((res) => res.url() === `${recordUrl}.data` && res.request().method() === "POST"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);

  await page.goto(recordUrl);
  await expect(page.locator("dl").getByText("Live", { exact: true })).toBeVisible();

  // Still audited: only tenant.compliance holds `core:audit:read` (signal.lead
  // does not — packages/core/src/rbac.ts), so the same journeys.test.ts:843
  // check is made through that persona's own reachable screen. The audit row's
  // `action` and `subjectRef` columns are raw stored strings (plain `text`
  // columns, never translated), so they read the same in this persona's
  // Arabic locale as they would in English.
  await loginAsComplianceOfficer(page);
  await page.goto("/admin/audit-log");
  await expect(
    page.getByRole("row", { name: new RegExp(`signal\\.campaigns\\.update.*${campaignId}`) })
  ).toBeVisible();
});

test("J-M1 a marketer without the launch permission is refused the whole campaigns screen", async ({ page }) => {
  await loginAsScoutLead(page);

  await page.goto("/signal/campaigns");
  // scout.lead holds no `signal:*` permission at all, so the read itself is
  // refused (root.tsx's ErrorBoundary renders the RFC 9457 status as prose,
  // apps/web/app/i18n/en.ts "error.forbidden") before a launch is ever tried.
  await expect(page.getByText("Your roles do not include access to this area.")).toBeVisible();
});
