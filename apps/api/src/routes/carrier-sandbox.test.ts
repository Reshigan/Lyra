import { describe, expect, it } from "vitest";
import { app } from "../index.js";
import { quoterFor } from "../engines/dist-quoter.js";
import { quoteOne, type PanelEntry } from "../engines/rating.js";
import type { Ctx } from "@lyra/core";
import type { schema } from "@lyra/db";
import type { Env } from "../env.js";

// The reference underwriter (ADR-0072). Two things are being proven: that it
// behaves like a carrier and not like a rate table, and that the quote adapter
// prices a real `pricingMode: "api"` offering through it over a service
// binding — the hop the seeded panel takes.

const NOW = 1_760_000_000_000;
const exec = { waitUntil() {}, passThroughOnException() {} };

/** No RATE, no CACHE: `throttle` skips when neither is bound (auth.ts). */
const bareEnv = {} as unknown as Env;

async function quote(body: unknown): Promise<any> {
  const res = await app.fetch(
    new Request("https://api.test/carrier-sandbox/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    bareEnv,
    exec as never
  );
  return { status: res.status, body: await res.json() };
}

const motor = (inputs: Record<string, unknown>) => quote({ offeringCode: "ZEN-MOT-LIVE", currency: "AED", inputs });

describe("the reference underwriter", () => {
  it("prices a clean risk and answers the http-json contract ADR-0070 defines", async () => {
    const res = await motor({ age: 34, sumInsuredMinor: 28_000_000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("quoted");
    expect(Number.isSafeInteger(res.body.premiumMinor)).toBe(true);
    expect(res.body.premiumMinor).toBeGreaterThan(0);
    expect(Number.isSafeInteger(res.body.taxMinor)).toBe(true);
    expect(Number.isSafeInteger(res.body.feesMinor)).toBe(true);
    expect(res.body.currency).toBe("AED");
    expect(res.body.validUntilMs).toBeGreaterThan(Date.now());
    expect(res.body.coverage).toMatchObject({ comprehensive: true });
  });

  it("is deterministic — the same risk twice is the same price", async () => {
    const a = await motor({ age: 41, sumInsuredMinor: 12_000_000 });
    const b = await motor({ age: 41, sumInsuredMinor: 12_000_000 });
    expect(a.body.premiumMinor).toBe(b.body.premiumMinor);
  });

  it("charges more for a worse risk, so a panel column moves for a visible reason", async () => {
    const clean = await motor({ age: 41, sumInsuredMinor: 12_000_000 });
    const claims = await motor({ age: 41, sumInsuredMinor: 12_000_000, priorClaims: true });
    const bigger = await motor({ age: 41, sumInsuredMinor: 24_000_000 });
    expect(claims.body.premiumMinor).toBeGreaterThan(clean.body.premiumMinor);
    expect(bigger.body.premiumMinor).toBeGreaterThan(clean.body.premiumMinor);
  });

  it("does not quote everything — it declines and refers, with a reason", async () => {
    expect(await motor({ age: 18, sumInsuredMinor: 9_000_000 })).toMatchObject({
      body: { status: "declined" }
    });
    expect(await motor({ age: 80, sumInsuredMinor: 9_000_000 })).toMatchObject({
      body: { status: "declined" }
    });
    // Above the automatic binding limit, and a young driver with a history.
    expect(await motor({ age: 40, sumInsuredMinor: 90_000_000 })).toMatchObject({
      body: { status: "referred" }
    });
    expect(await motor({ age: 22, sumInsuredMinor: 9_000_000, priorClaims: true })).toMatchObject({
      body: { status: "referred" }
    });
    // An undeclared risk is a referral, not a guess and not a 500.
    expect(await motor({})).toMatchObject({ body: { status: "referred" } });
    for (const r of [
      await motor({ age: 18, sumInsuredMinor: 9_000_000 }),
      await motor({ age: 40, sumInsuredMinor: 90_000_000 })
    ]) {
      expect(typeof r.body.reason).toBe("string");
      expect(r.body.premiumMinor).toBeUndefined();
    }
  });

  it("writes one currency and says so rather than quoting in the wrong one", async () => {
    const res = await quote({ offeringCode: "ZEN-MOT-LIVE", currency: "USD", inputs: { age: 34, sumInsuredMinor: 9_000_000 } });
    expect(res.body).toMatchObject({ status: "declined" });
    expect(res.body.premiumMinor).toBeUndefined();
  });

  it("rejects a body that is not a quote request rather than underwriting a guess", async () => {
    expect((await quote({ currency: "AED", inputs: {} })).status).toBe(400);
    expect((await quote({ offeringCode: "X", currency: "AEDX", inputs: {} })).status).toBe(400);
    expect((await quote({ offeringCode: "X", currency: "AED", inputs: "nope" })).status).toBe(400);
  });

  it("needs no session — it holds no tenant data and authenticates nothing", async () => {
    // If mw.ts stopped treating it as public this would be a 401, and the
    // seeded live-API offering would be an error row on every environment.
    expect((await motor({ age: 34, sumInsuredMinor: 28_000_000 })).status).toBe(200);
  });
});

describe("the seeded panel's live-API hop", () => {
  // The whole point of ADR-0072: `pricingMode: "api"` priced end to end,
  // through the adapter, over a binding, with no `fetch` stub anywhere.
  const env = {
    CARRIER_SANDBOX: { fetch: (input: string, init?: RequestInit) => app.fetch(new Request(input, init), bareEnv, exec as never) }
  } as unknown as Env;

  const entry = (): PanelEntry =>
    ({
      offering: {
        id: "of_zen",
        tenantId: "t1",
        productId: "pr_motor",
        providerId: "pv_zen",
        code: "ZEN-MOT-LIVE",
        currency: "AED",
        pricingMode: "api",
        ratingTableJson: null,
        coverageJson: null,
        baseCommissionPpm: 130_000,
        maxDiscountPpm: 0,
        minPremiumMinor: null,
        slaSeconds: 20,
        status: "active"
      } as unknown as typeof schema.distOfferings.$inferSelect,
      provider: {
        id: "pv_zen",
        tenantId: "t1",
        name: "Zenith Direct",
        currency: "AED",
        quoteEndpointJson: JSON.stringify({
          url: "https://carrier-sandbox.lyra.invalid/carrier-sandbox/quote",
          binding: "CARRIER_SANDBOX"
        }),
        panelStatus: "active"
      } as unknown as typeof schema.providers.$inferSelect
    }) as PanelEntry;

  const ctx = { now: NOW } as unknown as Ctx;

  it("prices through the adapter over the binding, indistinguishably from a table row", async () => {
    const out = await quoteOne(ctx, entry(), { age: 34, sumInsuredMinor: 28_000_000 }, quoterFor(env));
    expect(out.state).toBe("quoted");
    expect(out.premiumMinor).toBeGreaterThan(0);
    expect(out.currency).toBe("AED");
    expect(out.validUntil).toBeGreaterThan(NOW);
    expect(out.breakdown?.length).toBeGreaterThan(0);
  });

  it("carries the carrier's own decline through as a decline, not as an error", async () => {
    const out = await quoteOne(ctx, entry(), { age: 17, sumInsuredMinor: 9_000_000 }, quoterFor(env));
    expect(out.state).toBe("declined");
    expect(out.declineReason).toMatch(/appetite/i);
    expect(out.premiumMinor).toBeUndefined();
  });

  it("becomes one visible error row, never a fabricated number, when the carrier is unreachable", async () => {
    const out = await quoteOne(ctx, entry(), { age: 34, sumInsuredMinor: 28_000_000 }, quoterFor({} as unknown as Env));
    expect(out.state).toBe("error");
    expect(out.premiumMinor).toBeUndefined();
  });
});
