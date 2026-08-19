import { expect, test } from "@playwright/test";
import { and, asc, eq } from "drizzle-orm";
import { EntitlementsJson, PolicyJson, schema } from "@lyra/db";
import { makeLibsqlDb } from "@lyra/db/libsql";
import type { Ctx } from "@lyra/core";
import { sweepRenewals } from "../apps/api/src/engines/renewals.js";
import { API_ORIGIN, LIBSQL_URL, PERSONAS, TENANT_SLUG } from "./env.js";
import { goto } from "./fixtures.js";

// J-C3 "renew in one tap" (docs/06-roles-and-journeys.md; orbit.md §2.2's
// "one-tap renewal link (hosted page, tenant-branded)"). The page is public: no
// session, no shell, and the only credential is the token in the link, which
// staff mint from GET /v1/orbit/portal-links/renewal/:id.
//
// The retention desk is where a real send starts, so the token comes from that
// endpoint here too rather than being derived in the spec — if the derivation
// and the endpoint ever disagree, this spec is the one that notices.

// Both tests here need the one renewal the sweep below raises, and two workers
// sweeping the same libsql file at the same instant is a guaranteed
// `SQLITE_BUSY: database is locked`. Serial: the offer is raised once, then the
// wall test reuses the row rather than racing for a second one.
test.describe.configure({ mode: "serial" });

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

// orbit_renewals is not seeded — the scheduled sweep raises those rows from the
// policy book (seed/orbit.ts's header, apps/api/src/engines/renewals.ts), and
// the row it raises is shared with orbit-journeys.spec.ts, which accepts it. So
// this spec raises its own offer the same way axis-lifecycle.spec.ts does:
// clear the prior row for the policy, then run the sweep at that policy's
// expiry. Without the delete the sweep's per-policy dedupe sees the accepted
// row and raises nothing.
async function runRenewalsSweep(): Promise<void> {
  const db = makeLibsqlDb(LIBSQL_URL);
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG));
  if (!tenant) throw new Error(`no tenant with slug ${TENANT_SLUG}`);

  const [soonest] = await db
    .select({ id: schema.axisPolicies.id, endAt: schema.axisPolicies.endAt })
    .from(schema.axisPolicies)
    .where(and(eq(schema.axisPolicies.tenantId, tenant.id), eq(schema.axisPolicies.status, "active")))
    .orderBy(asc(schema.axisPolicies.endAt))
    .limit(1);
  if (!soonest) throw new Error("no active policy to raise a renewal from");

  await db.delete(schema.orbitRenewals).where(eq(schema.orbitRenewals.policyRef, soonest.id));

  await sweepRenewals({
    db: db as unknown as Ctx["db"],
    tenantId: tenant.id,
    actor: { kind: "system", id: "e2e-sweep", tenantId: tenant.id, grants: [] },
    requestId: "e2e-sweep",
    now: soonest.endAt,
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  });
}

async function renewals(token: string): Promise<Renewal[]> {
  const res = await fetch(`${API_ORIGIN}/v1/orbit/renewals?limit=100&sort=expiryAt&order=desc`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: Renewal[] };
  return data;
}

async function openRenewal(token: string): Promise<Renewal> {
  await runRenewalsSweep();
  const open = (await renewals(token)).find(
    (row) => row.expiryAt > Date.now() && row.state !== "accepted" && row.state !== "lost"
  );
  if (!open) throw new Error("the sweep raised no live renewal to offer");
  return open;
}

// The wall test only needs an id that exists — accepting it is the other test's
// job, and re-sweeping here would take the offer away from whichever of the two
// runs second.
async function anyRenewal(token: string): Promise<Renewal> {
  const existing = (await renewals(token))[0];
  if (existing) return existing;
  await runRenewalsSweep();
  const row = (await renewals(token))[0];
  if (!row) throw new Error("the sweep raised no renewal");
  return row;
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
  const renewal = await anyRenewal(token);
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
