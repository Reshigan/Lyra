import { expect, test } from "@playwright/test";
import { loginAsOrbitAgent } from "./fixtures.js";

// J-X1 "handover catch" (docs/06-roles-and-journeys.md:57): "AI escalates
// mid-chat -> human console opens with summary + suggested action -> resolve
// -> QA score visible next day". The acceptance test this journey actually
// has (apps/api/src/journeys.test.ts:608-642) is narrower than the docs'
// prose: (1) a handover note's summary is readable by the human it was
// written for, and (2) scoring that handover is refused to the agent who
// owns the conversation (403 on POST /v1/orbit/qa-scores) — scoring is the
// lead's job. Per CLAUDE.md's TDD rule, this spec matches that real scope.
//
// The "human console" is the bespoke thread page, apps/web/app/routes
// /conversation.tsx, reached from the generic conversations list via its
// record page's recordLink (apps/web/app/modules/orbit.ts:245: "Open
// thread"). It renders a read/write Handover notes card (CAN.handover /
// CAN.handoverWrite, conversation.tsx:841-876) and a read-only Quality
// scores card (CAN.qa, conversation.tsx:878-901) — there is no write form
// for a QA score anywhere on this page.
//
// Two gaps against the docs/acceptance-test's full scope, not fabricated:
// - The docs' "suggested action" (an AI ghost-text draft) is a separate,
//   already-covered surface; out of scope here.
// - journeys.test.ts:626-641 exercises the QA-scoring refusal as a runtime
//   403 an orbit.agent gets back from POST /v1/orbit/qa-scores. The web UI
//   enforces the same rule one step earlier: orbit.agent never holds
//   orbit:qa:score (packages/core/src/rbac.ts), so module.tsx's CreatePanel
//   for the qa-scores tab is never rendered at all (module.tsx:365,
//   held.has(tab.create)) — there is no submit-then-reject flow to exercise.
//   No orbit.lead persona is seeded either (packages/core/src/seed.ts's
//   PEOPLE array only seeds orbit.agent/orbit.retention/orbit.partners), so
//   the acceptance test's opposite case — a lead successfully scoring —
//   cannot be demonstrated by any persona this fixture set provides.

test("J-X1 the human console shows the AI's escalation summary and its QA score", async ({ page }) => {
  await loginAsOrbitAgent(page);

  // Seeded conversation carrying a real AI handover note and two
  // under-the-bar QA scores (packages/core/src/seed/orbit.ts:182-202,
  // 473-495, 560-579): an Arabic FNOL the bot misanswered with renewal
  // self-service copy, escalated to Sara, scored 52 then 61 against
  // orbit.escalation (the bar the conversation view draws is 70), disputed
  // once along the way.
  await page.goto("/orbit/conversations");
  const row = page.getByRole("row", { name: /wa:971559876543/ });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  // Client-side <Link> navigation (pushState, no full load) — wait for the
  // URL to change before reading it or acting on the next page.
  await page.waitForURL(/\/orbit\/conversations\/[^/]+$/);
  await page.getByRole("link", { name: "Open thread" }).click();
  await page.waitForURL(/\/orbit\/conversations\/[^/]+\/thread$/);

  await expect(
    page.getByRole("region", { name: "Handover notes" }).getByText(/Collision reported in Arabic on Sheikh Zayed Road/)
  ).toBeVisible();

  const rubricRows = page
    .getByRole("region", { name: "Quality scores" })
    .getByRole("listitem")
    .filter({ hasText: "Rubric: orbit.escalation" });
  await expect(rubricRows).toHaveCount(2);
  await expect(rubricRows.filter({ hasText: "Score: 52" })).toContainText("Disputed");
  await expect(rubricRows.filter({ hasText: "Score: 61" })).toBeVisible();
});

test("J-X1 an agent hands a conversation to a teammate with a readable summary", async ({ page }) => {
  await loginAsOrbitAgent(page);

  const externalRef = `e2e-jx1-${Date.now()}`;
  await page.goto("/orbit/conversations");
  await page.getByText("New — Conversations").click();
  // Channel renders as a Radix combobox (packages/ui/src/primitives.tsx
  // Select), not a native <select> — selectOption doesn't apply. Its listbox
  // repositions itself after Playwright's pre-click stability check — under
  // parallel load the click can land on stale coordinates and close the
  // listbox before landing on the option. Retry the open+select as a unit.
  await expect(async () => {
    await page.getByLabel("Channel*", { exact: true }).click();
    await page.getByRole("option", { name: "Web", exact: true }).click({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByLabel("External reference", { exact: true }).fill(externalRef);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const row = page.getByRole("row", { name: new RegExp(externalRef) });
  await expect(row).toBeVisible();
  await row.getByRole("link").first().click();
  await page.waitForURL(/\/orbit\/conversations\/[^/]+$/);
  await page.getByRole("link", { name: "Open thread" }).click();
  await page.waitForURL(/\/orbit\/conversations\/[^/]+\/thread$/);

  // orbit:handover:write — the same permission journeys.test.ts:608-621
  // exercises directly via POST /v1/orbit/handover-notes.
  const summary = "Customer asked about excess on a windscreen claim; needs a human.";
  await page.getByLabel("Hand to", { exact: true }).fill("yusuf.karim");
  await page.getByLabel("What the next person needs to know", { exact: true }).fill(summary);
  await page.getByRole("button", { name: "Save handover note", exact: true }).click();

  await expect(page.getByRole("region", { name: "Handover notes" }).getByText(summary)).toBeVisible();
});

test("J-X1 scoring the handover is the lead's job, not the agent's", async ({ page }) => {
  await loginAsOrbitAgent(page);

  // journeys.test.ts:622-641's shape is a runtime 403 on POST
  // /v1/orbit/qa-scores. The web UI enforces the same rule one step earlier:
  // orbit.agent never holds orbit:qa:score, so the create panel for this tab
  // is never rendered (module.tsx:365, held.has(tab.create)) — there is no
  // submit-then-reject flow to exercise here. Read access (the scores the
  // AI/lead already recorded) stays intact, which is the real, reachable
  // shape of "scoring is the lead's job, not the agent's" in this UI.
  await page.goto("/orbit/qa-scores");
  await expect(page.getByRole("row", { name: /orbit\.escalation/ })).toHaveCount(2);
  await expect(page.getByText("New — Quality scores")).toHaveCount(0);
});
