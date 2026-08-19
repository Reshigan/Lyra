import { expect, test } from "@playwright/test";
import { API_ORIGIN, PERSONAS } from "./env.js";
import { goto } from "./fixtures.js";

// J-C3 "renew in one tap" (docs/06-roles-and-journeys.md; orbit.md §2.2's
// "one-tap renewal link (hosted page, tenant-branded)"). The page is public: no
// session, no shell, and the only credential is the token in the link, which
// staff mint from GET /v1/orbit/portal-links/renewal/:id.
//
// The retention desk is where a real send starts, so the token comes from that
// endpoint here too rather than being derived in the spec — if the derivation
// and the endpoint ever disagree, this spec is the one that notices.

async function staffToken(email: string): Promise<string> {
  const res = await fetch(`${API_ORIGIN}/v1/auth/demo/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error(`demo login failed for ${email}: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

interface Renewal {
  id: string;
  state: string;
  expiryAt: number;
}

async function openRenewal(token: string): Promise<Renewal> {
  const res = await fetch(`${API_ORIGIN}/v1/orbit/renewals?limit=100&sort=expiryAt&order=desc`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: Renewal[] };
  const open = data.find((row) => row.expiryAt > Date.now() && row.state !== "accepted" && row.state !== "lost");
  if (!open) throw new Error("no live renewal in the seed to offer");
  return open;
}

async function linkFor(token: string, kind: string, id: string): Promise<string> {
  const res = await fetch(`${API_ORIGIN}/v1/orbit/portal-links/${kind}/${id}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  const link = new URL(url);
  return `${link.pathname}${link.search}`;
}

test("J-C3 a customer renews in one tap from the hosted page @journey:J-C3 @accept:M3", async ({ page }) => {
  const token = await staffToken(PERSONAS.orbitRetention.email);
  const renewal = await openRenewal(token);

  await goto(page, await linkFor(token, "renewal", renewal.id));

  // The page belongs to the tenant, not to us: brand-token rule (CLAUDE.md §5)
  // matters most on a surface a stranger reaches with no session.
  await expect(page.locator("main")).not.toContainText(/\bLYRA\b/);
  await expect(page.getByRole("button", { name: /renew/i })).toBeVisible();

  await page.getByRole("button", { name: /renew/i }).click();

  // Recorded, not charged: the page confirms the decision and offers no payment.
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("button", { name: /renew/i })).toHaveCount(0);

  // Re-opening the same link is safe — one accepted renewal, not two.
  await page.reload();
  await expect(page.getByRole("button", { name: /renew/i })).toHaveCount(0);
});

test("J-C3 the hosted page opens for nobody without the token in the link @journey:J-C3 @accept:M3", async ({
  page
}) => {
  const token = await staffToken(PERSONAS.orbitRetention.email);
  const renewal = await openRenewal(token);
  const link = await linkFor(token, "renewal", renewal.id);
  const path = link.split("?")[0]!;

  // No token, a mangled token, and an id that never existed must all land on the
  // same wall: nothing here may tell a stranger which renewals are real. The
  // support request id on the boundary differs per request by design, so the
  // heading is what is compared, not the whole page.
  const headings: string[] = [];
  for (const url of [path, `${path}?token=deadbeef`, "/portal/gonxt/renewals/rnw_nope?token=deadbeef"]) {
    await page.goto(url);
    await expect(page.getByRole("button", { name: /renew/i })).toHaveCount(0);
    headings.push((await page.getByRole("heading").first().textContent()) ?? "");
    // "not yours", "no permission" and friends would answer the question the
    // 404 exists to refuse.
    await expect(page.locator("body")).not.toContainText(/not yours|another (customer|tenant)|permission/i);
  }
  expect(headings[1]).toBe(headings[0]);
  expect(headings[2]).toBe(headings[0]);
});
