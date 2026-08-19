import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@lyra/core";
import type { schema } from "@lyra/db";
import { quoteOne, type PanelEntry } from "./rating.js";
import { quoterFor } from "./dist-quoter.js";
import type { Env } from "../env.js";

// The live-underwriter half of the rating seam (docs/16 "build to the seams",
// ADR-0070). Every test here runs against a mock carrier stubbed into `fetch` —
// nothing in this file may reach a real host. What is being proven is not that
// a happy path works but that each way a carrier can misbehave lands on the
// engine's existing visible-error row instead of a number nobody underwrote.

const NOW = 1_760_000_000_000;
const ctx = { now: NOW } as unknown as Ctx;

const env = { CARRIER_FALCON_API_KEY: "sk-falcon-live-xyz" } as unknown as Env;

type OfferingRow = typeof schema.distOfferings.$inferSelect;
type ProviderRow = typeof schema.providers.$inferSelect;

function offeringRow(extra: Partial<OfferingRow> = {}): OfferingRow {
  return {
    id: "of_1",
    tenantId: "t1",
    productId: "pr_motor",
    providerId: "pv_falcon",
    code: "FAL-MOT-COMP",
    nameJson: JSON.stringify({ en: "Falcon Motor Comprehensive" }),
    currency: "AED",
    pricingMode: "api",
    ratingInputsJson: null,
    ratingTableJson: null,
    coverageJson: JSON.stringify({ excessMinor: 50_000, roadside: true }),
    eligibilityJson: null,
    baseCommissionPpm: 150_000,
    maxDiscountPpm: 0,
    minPremiumMinor: null,
    maxSumInsuredMinor: null,
    slaSeconds: 30,
    channelKeysJson: null,
    upsellOfOfferingId: null,
    crossSellTagsJson: null,
    status: "active",
    effectiveFrom: NOW - 1000,
    effectiveTo: null,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    deletedAt: null,
    ...extra
  } as OfferingRow;
}

function providerRow(quoteEndpointJson: string | null): ProviderRow {
  return {
    id: "pv_falcon",
    tenantId: "t1",
    name: "Falcon Insurance",
    kind: "insurer",
    isInternal: false,
    linesJson: null,
    integrationJson: JSON.stringify({ mode: "api" }),
    commissionJson: null,
    settlementTermsJson: null,
    currency: "AED",
    quoteEndpointJson,
    panelStatus: "active",
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000
  } as ProviderRow;
}

const ENDPOINT = JSON.stringify({
  url: "https://api.falcon.example/quote",
  authRef: "CARRIER_FALCON_API_KEY"
});

function entry(endpoint: string | null = ENDPOINT, offering: Partial<OfferingRow> = {}): PanelEntry {
  return { offering: offeringRow(offering), provider: providerRow(endpoint) };
}

/** A carrier that answers whatever the test says, and records what it was asked. */
function carrier(reply: (req: { url: string; headers: Headers; body: any }) => unknown) {
  const spy = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const out = reply({
      url: String(input),
      headers: new Headers(init.headers as HeadersInit),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined
    });
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const QUOTED = {
  status: "quoted",
  premiumMinor: 214_500,
  taxMinor: 10_725,
  feesMinor: 2_500,
  currency: "AED",
  coverage: { excessMinor: 25_000, agencyRepair: true },
  breakdown: [{ label: "carrier.base", amountMinor: 214_500 }]
};

const price = (e: PanelEntry = entry(), inputs: Record<string, unknown> = { age: 34, market: "AE" }) =>
  quoteOne(ctx, e, inputs, quoterFor(env));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the http carrier quoter — the happy path", () => {
  it("prices an api offering against the carrier and returns a row a caller cannot tell from a table quote", async () => {
    carrier(() => QUOTED);
    const out = await price();
    expect(out).toMatchObject({
      offeringId: "of_1",
      providerId: "pv_falcon",
      state: "quoted",
      premiumMinor: 214_500,
      taxMinor: 10_725,
      feesMinor: 2_500,
      currency: "AED",
      coverage: { excessMinor: 25_000, agencyRepair: true },
      breakdown: [{ label: "carrier.base", amountMinor: 214_500 }]
    });
    // docs/05 §4: the comparison must not depend on how the number was obtained,
    // so every field the table branch fills is filled here too.
    expect(out.validUntil).toBeGreaterThan(NOW);
    expect(typeof out.latencyMs).toBe("number");
    expect(out.declineReason).toBeUndefined();
  });

  it("sends the offering's own code and the risk, and authenticates from the env binding the provider names", async () => {
    const spy = carrier(() => QUOTED);
    await price();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.falcon.example/quote");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers as HeadersInit).get("authorization")).toBe("Bearer sk-falcon-live-xyz");
    expect(JSON.parse(init.body as string)).toMatchObject({
      offeringCode: "FAL-MOT-COMP",
      currency: "AED",
      inputs: { age: 34, market: "AE" }
    });
  });

  it("never puts the credential anywhere the outcome can carry it to a log or an audit row", async () => {
    carrier(() => new Response("upstream exploded: key=sk-falcon-live-xyz", { status: 500 }));
    const out = await price();
    expect(JSON.stringify(out)).not.toContain("sk-falcon-live-xyz");
  });

  it("falls back to the offering's declared coverage when the carrier does not restate it", async () => {
    carrier(() => ({ status: "quoted", premiumMinor: 100_000 }));
    const out = await price();
    expect(out.coverage).toEqual({ excessMinor: 50_000, roadside: true });
    expect(out.taxMinor).toBe(0);
    expect(out.feesMinor).toBe(0);
  });

  it("honours a carrier's own validity window, but only a believable one", async () => {
    carrier(() => ({ ...QUOTED, validUntilMs: NOW + 3_600_000 }));
    expect((await price()).validUntil).toBe(NOW + 3_600_000);

    carrier(() => ({ ...QUOTED, validUntilMs: NOW - 1 }));
    expect((await price()).validUntil).toBeGreaterThan(NOW);

    carrier(() => ({ ...QUOTED, validUntilMs: 8_640_000_000_000_001 }));
    const far = (await price()).validUntil as number;
    expect(Number.isSafeInteger(far)).toBe(true);
    expect(new Date(far).toISOString()).toBeTruthy();
  });
});

describe("the http carrier quoter — every way a carrier fails", () => {
  it("degrades a carrier that never answers within the offering's SLA to a timeout row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init: RequestInit = {}) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
          })
      )
    );
    const out = await price(entry(ENDPOINT, { slaSeconds: 1 }));
    expect(out.state).toBe("timeout");
    expect(out.premiumMinor).toBeUndefined();
    expect(out.declineReason).toMatch(/timeout/i);
  });

  it("degrades a 5xx to a visible error rather than a fabricated number", async () => {
    carrier(() => new Response("gateway down", { status: 503 }));
    const out = await price();
    expect(out.state).toBe("error");
    expect(out.premiumMinor).toBeUndefined();
    expect(out.declineReason).toContain("503");
  });

  it("degrades a 4xx the same way — a rejected request is our bug, not a decline", async () => {
    carrier(() => new Response(JSON.stringify({ error: "bad schema" }), { status: 422 }));
    const out = await price();
    expect(out.state).toBe("error");
    expect(out.declineReason).toContain("422");
  });

  it("degrades an unreachable carrier without leaking the exception text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED https://api.falcon.example/quote token=sk-falcon-live-xyz`);
      })
    );
    const out = await price();
    expect(out.state).toBe("error");
    expect(JSON.stringify(out)).not.toContain("sk-falcon-live-xyz");
  });

  it("degrades a body that is not JSON at all", async () => {
    carrier(() => new Response("<html>maintenance</html>", { status: 200 }));
    const out = await price();
    expect(out.state).toBe("error");
    expect(out.premiumMinor).toBeUndefined();
  });

  it("degrades valid JSON that is the wrong shape", async () => {
    carrier(() => ({ status: "quoted", premiumMinor: "two hundred" }));
    expect((await price()).state).toBe("error");
  });

  it("degrades a quote with no premium at all — the one failure that must never become a number", async () => {
    carrier(() => ({ status: "quoted", taxMinor: 10_000, currency: "AED" }));
    const out = await price();
    expect(out.state).toBe("error");
    expect(out.premiumMinor).toBeUndefined();
    expect(out.declineReason).toMatch(/premium/i);
  });

  it("refuses a premium that is not a whole number of minor units", async () => {
    carrier(() => ({ status: "quoted", premiumMinor: 214_500.5 }));
    expect((await price()).state).toBe("error");
    carrier(() => ({ status: "quoted", premiumMinor: -1 }));
    expect((await price()).state).toBe("error");
  });

  it("refuses a quote priced in a currency the offering does not sell in", async () => {
    carrier(() => ({ ...QUOTED, currency: "USD" }));
    const out = await price();
    expect(out.state).toBe("error");
    expect(out.premiumMinor).toBeUndefined();
    expect(out.currency).toBe("AED");
    expect(out.declineReason).toMatch(/currency/i);
  });

  it("carries a carrier's decline through as a decline with its reason", async () => {
    carrier(() => ({ status: "declined", reason: "vehicle older than 12 years" }));
    const out = await price();
    expect(out.state).toBe("declined");
    expect(out.declineReason).toBe("vehicle older than 12 years");
    expect(out.premiumMinor).toBeUndefined();
  });

  it("carries a carrier's referral through as a referral", async () => {
    carrier(() => ({ status: "referred", reason: "manual underwriting required" }));
    const out = await price();
    expect(out.state).toBe("referred");
    expect(out.declineReason).toBe("manual underwriting required");
  });

  it("bounds and de-fangs the free text a carrier hands us before it is stored", async () => {
    carrier(() => ({ status: "declined", reason: `line one\nline two ${"x".repeat(400)}` }));
    const reason = (await price()).declineReason as string;
    expect(reason.length).toBeLessThanOrEqual(120);
    expect(reason).not.toContain("\n");
  });
});

describe("the http carrier quoter — configuration that must not reach the network", () => {
  const refused = async (endpoint: string | null, match: RegExp) => {
    const spy = carrier(() => QUOTED);
    const out = await price(entry(endpoint));
    expect(out.state).toBe("error");
    expect(out.declineReason).toMatch(match);
    expect(spy).not.toHaveBeenCalled();
  };

  it("refuses an api offering whose provider declares no quote endpoint", async () => {
    await refused(null, /endpoint/i);
  });

  it("refuses an unparseable endpoint config", async () => {
    await refused("{not json", /endpoint/i);
  });

  it("refuses an endpoint naming a wire format no adapter implements", async () => {
    await refused(JSON.stringify({ adapter: "soap-1.1", url: "https://api.falcon.example/quote" }), /adapter/i);
  });

  it("refuses a plaintext endpoint — a risk profile does not cross the internet in the clear", async () => {
    await refused(JSON.stringify({ url: "http://api.falcon.example/quote" }), /https/i);
  });

  it("refuses a loopback or link-local endpoint, so tenant-editable config cannot aim us inward", async () => {
    await refused(JSON.stringify({ url: "https://localhost:8787/v1/anything" }), /host/i);
    await refused(JSON.stringify({ url: "https://169.254.169.254/latest/meta-data/" }), /host/i);
    await refused(JSON.stringify({ url: "https://[::1]/quote" }), /host/i);
    await refused(JSON.stringify({ url: "https://vault.internal/quote" }), /host/i);
  });

  it("refuses an authRef that names a binding outside the carrier namespace", async () => {
    // The whole exfiltration path in one test: provider config is tenant-editable,
    // so an authRef that could name FIELD_KEY or ANTHROPIC_API_KEY would post our
    // own secrets to a URL the same tenant chose.
    await refused(JSON.stringify({ url: "https://api.falcon.example/quote", authRef: "FIELD_KEY" }), /authRef/i);
    await refused(
      JSON.stringify({ url: "https://api.falcon.example/quote", authRef: "ANTHROPIC_API_KEY" }),
      /authRef/i
    );
  });

  it("refuses when the named credential is not bound in this environment", async () => {
    await refused(
      JSON.stringify({ url: "https://api.falcon.example/quote", authRef: "CARRIER_CEDAR_API_KEY" }),
      /credential/i
    );
  });

  it("calls an endpoint that declares no credential at all — a public sandbox is legitimate", async () => {
    const spy = carrier(() => QUOTED);
    const out = await price(entry(JSON.stringify({ url: "https://sandbox.falcon.example/quote" })));
    expect(out.state).toBe("quoted");
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers as HeadersInit).get("authorization")).toBeNull();
  });
});

describe("the deployed panel", () => {
  it("prices a table offering without the carrier ever being called", async () => {
    const spy = carrier(() => QUOTED);
    const out = await quoteOne(
      ctx,
      entry(null, {
        pricingMode: "table",
        ratingTableJson: JSON.stringify({ base: 60_000, minPremiumMinor: 95_000, taxPpm: 50_000 })
      }),
      { age: 34 },
      quoterFor(env)
    );
    expect(out.state).toBe("quoted");
    expect(out.premiumMinor).toBe(95_000);
    expect(spy).not.toHaveBeenCalled();
  });
});
