import { expect, test } from "@playwright/test";
import { API_ORIGIN } from "./env.js";

// J-X3 "partner integration" (docs/06-roles-and-journeys.md): "portal signup
// -> sandbox key -> mock quote in <30 min". No web UI exists for this door
// (apps/web/app/routes.ts has no onboarding/partner route) — it is API-only
// by design, already covered end to end against an in-memory app in
// apps/api/src/partner-signup.test.ts. This spec exercises the same contract
// against the real running API server (webServer in playwright.config.ts),
// the one gap that vitest run can't close.

test("J-X3 partner portal signup mints a sandbox key scoped to sandbox use", async ({ request }) => {
  const email = `jx3-${Date.now()}@acme.example`;
  const res = await request.post(`${API_ORIGIN}/v1/onboarding/partners/signup`, {
    data: {
      tenantSlug: "gonxt",
      companyName: "J-X3 e2e Aggregator",
      contactEmail: email,
      contactName: "E2E Bot",
      kind: "aggregator"
    }
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.stage).toBe("prospect");
  expect(body.sandboxFlag).toBe(true);
  expect(body.sandboxKey).toMatch(/^qvk_test_[A-Z2-7]{40,}$/);

  // The mock-quote surface (J-X3's next step) is in scope for the fresh key.
  const allowed = await request.get(`${API_ORIGIN}/v1/dist/quote-requests`, {
    headers: { authorization: `Bearer ${body.sandboxKey}` }
  });
  expect(allowed.status()).toBe(200);

  // Staff-only surfaces stay staff-only.
  const denied = await request.get(`${API_ORIGIN}/v1/core/users`, {
    headers: { authorization: `Bearer ${body.sandboxKey}` }
  });
  expect(denied.status()).toBe(403);
});

test("J-X3 repeat signup from the same email is throttled", async ({ request }) => {
  const payload = {
    tenantSlug: "gonxt",
    companyName: "J-X3 Repeat Co",
    contactEmail: `jx3-repeat-${Date.now()}@acme.example`,
    kind: "bank"
  };
  const first = await request.post(`${API_ORIGIN}/v1/onboarding/partners/signup`, { data: payload });
  expect(first.status()).toBe(201);
  const second = await request.post(`${API_ORIGIN}/v1/onboarding/partners/signup`, { data: payload });
  expect(second.status()).toBe(429);
});
