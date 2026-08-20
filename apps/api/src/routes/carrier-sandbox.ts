import { Hono } from "hono";
import { z } from "zod";
import { body } from "../http.js";
import { throttle } from "../auth.js";
import type { App } from "../env.js";

// The first-party reference underwriter (ADR-0072). It exists so that
// `pricingMode: "api"` is proven on the seeded panel over a real HTTP hop
// instead of only in a test with `fetch` stubbed: there is no third-party
// carrier reachable from a demo, an e2e run or a CI box.
//
// From `engines/dist-quoter.ts`'s point of view this is a foreign server. It
// is deliberately NOT a LYRA API:
//   - no tenant, no session, no ctx, no audit row, no database — it is a
//     stateless price calculator over the risk it was posted;
//   - it is mounted outside `/v1` and kept out of the OpenAPI document, the
//     same as `/health`, because nothing in packages/sdk should ever call it;
//   - it answers the `http-json` wire contract exactly as ADR-0070 defines it.
//     The adapter is the client and does not bend to suit this server.
//
// It is reachable in-Worker over the `CARRIER_SANDBOX` service binding rather
// than by hostname (a Worker fetching its own zone is Cloudflare error 1042),
// but being mounted on the API it is also reachable publicly, so it is behind
// the same IP throttle as the rest of the unauthenticated surface.

export const carrierSandboxRoutes = new Hono<App>();

const QUOTE_MAX = 60;
const QUOTE_WINDOW_SEC = 60;

/** This carrier underwrites in one currency, as most real ones do. */
const WRITES = "AED";

const MINOR = 100;
const PPM = 1_000_000;
/** UAE VAT, 5%. */
const TAX_PPM = 50_000;
const POLICY_FEE_MINOR = 5_000;
const BASE_MINOR = 68_000;
/** Rate on the declared value of the risk, per million minor units. */
const VALUE_PPM = 8_600;
const CLAIMS_LOADING_MINOR = 30_000;
/** Above this the underwriter wants a human. */
const BIND_LIMIT_MINOR = 50_000_000;
const MIN_AGE = 21;
const MAX_AGE = 75;
const VALID_FOR_MS = 3 * 86_400_000;

const QuoteBody = z.object({
  offeringCode: z.string().min(1).max(64),
  currency: z.string().length(3),
  inputs: z.record(z.string(), z.unknown()).default({})
});

/** Risk fields arrive as whatever the caller had. Anything unusable is absent. */
function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

type Answer =
  | { status: "declined" | "referred"; reason: string }
  | { status: "quoted"; premiumMinor: number; taxMinor: number; feesMinor: number; breakdown: { label: string; amountMinor: number }[] };

/**
 * Deterministic underwriting: the same risk always gets the same answer, so a
 * demo is reproducible and a screenshot stays true. Not every risk is a price —
 * a panel where one carrier always says yes teaches a viewer nothing.
 */
function underwrite(currency: string, inputs: Record<string, unknown>): Answer {
  if (currency !== WRITES) return { status: "declined", reason: `this carrier writes ${WRITES} only` };

  const age = num(inputs.age);
  const value = num(inputs.sumInsuredMinor);
  const priorClaims = inputs.priorClaims === true || inputs.priorClaims === "true";

  if (age === undefined) return { status: "referred", reason: "no driver age declared — manual underwriting" };
  if (age < MIN_AGE) return { status: "declined", reason: `drivers under ${MIN_AGE} are outside this carrier's appetite` };
  if (age > MAX_AGE) return { status: "declined", reason: `drivers over ${MAX_AGE} are outside this carrier's appetite` };
  if (value === undefined || value <= 0) return { status: "referred", reason: "no insured value declared — manual underwriting" };
  if (value > BIND_LIMIT_MINOR) {
    return { status: "referred", reason: `insured value above the ${BIND_LIMIT_MINOR / MINOR} ${WRITES} automatic binding limit` };
  }
  if (priorClaims && age < 25) return { status: "referred", reason: "claims history on a young driver needs an underwriter" };

  const bandPpm = age < 25 ? 1_400_000 : age < 40 ? 1_020_000 : age < 60 ? 880_000 : 1_150_000;
  const risk = BASE_MINOR + Math.round((value * VALUE_PPM) / PPM);
  const rated = Math.round((risk * bandPpm) / PPM);
  const loading = priorClaims ? CLAIMS_LOADING_MINOR : 0;
  const premiumMinor = rated + loading;

  return {
    status: "quoted",
    premiumMinor,
    taxMinor: Math.round((premiumMinor * TAX_PPM) / PPM),
    feesMinor: POLICY_FEE_MINOR,
    breakdown: [
      { label: "Base rate", amountMinor: rated },
      ...(loading ? [{ label: "Claims loading", amountMinor: loading }] : []),
      { label: "Policy fee", amountMinor: POLICY_FEE_MINOR }
    ]
  };
}

carrierSandboxRoutes.post("/quote", async (c) => {
  const ip = c.req.header("cf-connecting-ip");
  if (ip) await throttle(c.env, `carrier-sandbox:${ip}`, QUOTE_MAX, QUOTE_WINDOW_SEC);

  const input = await body(c, QuoteBody);
  const answer = underwrite(input.currency, input.inputs);
  if (answer.status !== "quoted") return c.json(answer);

  return c.json({
    ...answer,
    currency: WRITES,
    coverage: {
      comprehensive: true,
      excessMinor: 100_000,
      agencyRepair: (num(input.inputs.age) ?? 0) >= 30,
      roadsideAssistance: true
    },
    // Wall clock, not the caller's simulated one: a real carrier does not share
    // our demo's clock. The adapter re-validates this instant before trusting it.
    validUntilMs: Date.now() + VALID_FOR_MS
  });
});
