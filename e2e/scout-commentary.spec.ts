import { expect, test } from "@playwright/test";
import { content, goto, loginAsScoutLead, loginAsSignalLead } from "./fixtures.js";

// J-P1 "the pivot" (docs/06-roles-and-journeys.md), the radar half: the reader's
// commentary on a whitespace is read where the decision is argued, and the
// whitespace that survives it is handed to the campaign studio.
//
// Two things this spec exists to hold:
//
//  1. The commentary is not hover-only. It is in the DOM and in the
//     accessibility tree before any pointer arrives — the dot names it in
//     aria-describedby — and hover only changes its opacity. That is why the
//     assertions are toHaveCSS("opacity", …) rather than toBeVisible(): an
//     opacity-0 element is "visible" to Playwright, and it must be, because it
//     is visible to a screen reader. The suite forces prefers-reduced-motion,
//     so nothing here waits on a transition finishing.
//  2. Handing a theme over is consequential (CLAUDE.md §4). The first attempt
//     comes back queued for approval and the screen says so — it never claims a
//     campaign exists. The drafts only appear after the approval.
test("J-P1 whitespace commentary reads on hover and on focus, then converts into a campaign @journey:J-P1 @accept:M5", async ({
  page
}) => {
  await loginAsScoutLead(page);
  await goto(page, "/scout/radar");

  // Dots are named by their cluster's theme (scout.shared.ts dots()). Seeded in
  // packages/core/src/seed/scout.ts. "EV motor cover" is the `validating` row:
  // the handover below is a hop to `validated`, and the seed's `validated` row
  // ("Agency repair lost at renewal") already has a campaign, so promoting it
  // again is a 409 by design (WHITESPACE_TRANSITIONS has no validated self-hop).
  const dot = content(page).getByRole("link", { name: /EV motor cover/ }).first();
  await expect(dot).toBeVisible();

  const ghostId = await dot.getAttribute("aria-describedby");
  expect(ghostId, "the dot describes itself with its commentary").toBeTruthy();
  const ghost = page.locator(`[id="${ghostId}"]`);

  // Present and described before any hover; hidden only by opacity.
  await expect(ghost).toContainText(/On the book/);
  await expect(ghost).toHaveCSS("opacity", "0");

  await dot.hover();
  await expect(ghost).toHaveCSS("opacity", "1");

  // The keyboard reaches the same reading. Move the pointer off the chart
  // first, or focus-within and hover would be indistinguishable.
  await content(page).getByRole("heading").first().hover();
  await expect(ghost).toHaveCSS("opacity", "0");
  await dot.focus();
  await expect(ghost).toHaveCSS("opacity", "1");

  // Open the dossier for that theme; its chip carries the same reading with the
  // evidence behind it inspectable rather than only the prose.
  await dot.click();
  await page.waitForURL(/\/scout\/radar\?w=/);
  const dossierUrl = page.url();
  await content(page).getByRole("button", { name: "Commentary" }).click();
  const why = page.getByRole("dialog", { name: "Why" });
  // The evidence list is the server's own grounding lines, verbatim
  // (whitespaceEvidenceLines in packages/model-gateway/src/whitespace-brief.ts),
  // in the tenant's domain-pack vocabulary — not a second wording of them.
  await expect(why.getByText(/Demand signals behind this candidate/)).toBeVisible();
  await expect(why.getByText(/Demand momentum score/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Consequential: gated by scout.whitespace_promote (packages/core/src
  // /approvals.ts), single control, so the same scout lead decides it.
  const convert = content(page).getByRole("button", { name: "Hand this to the campaign studio" });
  await expect(convert).toBeEnabled();
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/scout/radar") && res.request().method() === "POST"),
    convert.click()
  ]);

  await expect(page.getByRole("status").getByText("Queued for approval")).toBeVisible();
  await expect(page.getByRole("status").getByText(/scout\.whitespace_promote/)).toBeVisible();
  // Nothing was drafted and nothing sent, so no tray and no studio link yet.
  await expect(content(page).getByRole("link", { name: "Read the drafts" })).toHaveCount(0);

  await content(page).getByRole("link", { name: "Open the approvals queue" }).click();
  const request = page.getByRole("region", { name: "Whitespace promote" }).first();
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Approved. The action may now proceed.");

  // Retry: the same handover now goes through and the drafts arrive as a tray
  // to read, not as something that was sent.
  await goto(page, dossierUrl);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/scout/radar") && res.request().method() === "POST"),
    content(page).getByRole("button", { name: "Hand this to the campaign studio" }).click()
  ]);

  const tray = page.getByRole("status").filter({ hasText: "Background drafts" });
  // "none sent" is the point: the model wrote, it did not publish.
  await expect(tray).toContainText(/Handed over\./);
  await expect(tray).toContainText(/none sent\.|Nothing drafted yet\./);
  // The tray offers no studio link here, and that is the RBAC answer, not a gap:
  // scout.lead has no signal permission (packages/core/src/rbac.ts), so SIGNAL is
  // not in its shell list and the link would lead to a 403. J-P1 ends at the
  // handover; the campaign is picked up on the other side of the bus.
  await expect(tray.getByRole("link", { name: "Read the drafts" })).toHaveCount(0);

  // The other side: the campaign the handover created is waiting as a draft in
  // the studio for the person who owns campaigns. With no model bound in e2e the
  // brief is the deterministic fallback, so its name is `<category> — unserved
  // demand` (fallbackWhitespaceBrief) — "EV motor cover" sits on the motor line.
  await loginAsSignalLead(page);
  await goto(page, "/signal/studio");
  await expect(content(page).getByText("motor — unserved demand").first()).toBeVisible();
});
