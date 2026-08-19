import type { schema } from "@lyra/db";
import type { Env } from "../env.js";
import type { ProviderQuoter, QuoteOutcome } from "./rating.js";

// The live-underwriter side of the rating seam (docs/16 "build to the seams",
// ADR-0070). `pricingMode: "api"` has always been in the engine; this is the
// first thing behind it that speaks to a real carrier.
//
// The rule that shapes every line below: a carrier that misbehaves produces a
// visible error row, never a number nobody underwrote. There is no defaulting,
// no rounding a bad field into a good one, and no partial quote.

type Offering = typeof schema.distOfferings.$inferSelect;

/** What the engine hands back for one offering, before it stamps ids and latency. */
type Outcome = Omit<QuoteOutcome, "offeringId" | "providerId" | "latencyMs">;

/**
 * `core_providers.quote_endpoint_json`. Tenant-editable, so every field is
 * treated as hostile: see `quoterFor` for the guards.
 */
interface QuoteEndpoint {
  /** Wire format. Defaults to the only one implemented. */
  adapter?: string;
  url?: string;
  /** The NAME of a wrangler secret, never a value. Must be `CARRIER_*`. */
  authRef?: string;
}

const WEEK = 7 * 86_400_000;
const YEAR = 365 * 86_400_000;

/** Free text from a carrier goes into a stored row, so bound it and flatten it. */
const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

const object = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const parse = <T>(json: string | null): T | undefined => {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
};

/** Minor units are integers. A fractional or negative one is a carrier bug, not a price. */
const minor = (v: unknown): number | undefined =>
  Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined;

/**
 * Hosts a tenant must not be able to aim us at by editing a provider row:
 * loopback, link-local metadata, and split-horizon internal names.
 */
function internalHost(host: string): boolean {
  if (host.startsWith("[")) return true; // IPv6 literal — no legitimate carrier is one
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 literal, ditto
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  );
}

/**
 * A carrier wire format. One today; the map exists so that an endpoint naming a
 * format nobody implements is a visible error rather than a request sent in the
 * wrong protocol and parsed as if it had worked.
 *
 * ponytail: a Record of one. A second carrier that speaks SOAP or a signed
 * payload adds a key here and nothing else.
 */
type CarrierAdapter = (args: {
  url: string;
  token: string | undefined;
  offering: Offering;
  inputs: Record<string, unknown>;
  timeoutMs: number;
  now: number;
}) => Promise<Outcome>;

const ADAPTERS: Record<string, CarrierAdapter> = { "http-json": httpJson };

export function quoterFor(env: Env): ProviderQuoter {
  return async ({ offering, provider, inputs, timeoutMs, now }) => {
    const bad = (reason: string): Outcome => ({
      state: "error",
      taxMinor: 0,
      feesMinor: 0,
      currency: offering.currency,
      declineReason: reason
    });

    const cfg = parse<QuoteEndpoint>(provider?.quoteEndpointJson ?? null);
    if (!cfg?.url || typeof cfg.url !== "string") return bad("provider has no usable quote endpoint");

    const name = cfg.adapter ?? "http-json";
    const adapter = ADAPTERS[name];
    if (!adapter) return bad(`no quote adapter for ${clean(name)}`);

    let url: URL;
    try {
      url = new URL(cfg.url);
    } catch {
      return bad("provider quote endpoint is not a url");
    }
    if (url.protocol !== "https:") return bad("quote endpoint must use https");
    if (internalHost(url.hostname)) return bad("quote endpoint host is not reachable externally");

    // Provider rows are tenant CRUD. Without this the authRef could name
    // FIELD_KEY and post it to a host the same tenant chose (ADR-0070).
    let token: string | undefined;
    if (cfg.authRef !== undefined) {
      if (typeof cfg.authRef !== "string" || !/^CARRIER_[A-Z0-9_]+$/.test(cfg.authRef)) {
        return bad("quote endpoint authRef must name a CARRIER_* secret");
      }
      token = (env as unknown as Record<string, unknown>)[cfg.authRef] as string | undefined;
      if (!token) return bad("carrier credential is not configured in this environment");
    }

    try {
      return await adapter({ url: url.toString(), token, offering, inputs, timeoutMs, now });
    } catch {
      // ponytail: the thrown text is deliberately dropped rather than logged —
      // fetch failures quote the request back at you, and the request carries a
      // bearer token. Reproduce with the carrier's own sandbox, not our logs.
      return bad("carrier request failed");
    }
  };
}

/** The default wire format: POST the risk as JSON, read a quote back as JSON. */
async function httpJson({
  url,
  token,
  offering,
  inputs,
  timeoutMs,
  now
}: Parameters<CarrierAdapter>[0]): Promise<Outcome> {
  const base = { taxMinor: 0, feesMinor: 0, currency: offering.currency };
  const bad = (reason: string): Outcome => ({ ...base, state: "error" as const, declineReason: reason });

  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ offeringCode: offering.code, currency: offering.currency, inputs }),
      signal
    });
  } catch (e) {
    if (signal.aborted) {
      return { ...base, state: "timeout", declineReason: `carrier timeout after ${timeoutMs}ms` };
    }
    throw e;
  }

  // A 4xx is our request being wrong and a 5xx is theirs being down. Both are
  // an error row: neither is an underwriting decision.
  if (!res.ok) return bad(`carrier returned http ${res.status}`);

  let body: Record<string, unknown> | undefined;
  try {
    body = object(await res.json());
  } catch {
    return bad("carrier returned a body that is not json");
  }
  if (!body) return bad("carrier returned a body that is not a quote");

  const reason = body.reason !== undefined ? clean(body.reason) : undefined;
  if (body.status === "declined") return { ...base, state: "declined", ...(reason ? { declineReason: reason } : {}) };
  if (body.status === "referred") return { ...base, state: "referred", ...(reason ? { declineReason: reason } : {}) };

  const premiumMinor = minor(body.premiumMinor);
  if (premiumMinor === undefined) return bad("carrier quote has no usable premium");

  // A price in the wrong currency cannot be compared against the panel and must
  // not be silently relabelled with the offering's own.
  if (body.currency !== undefined && body.currency !== offering.currency) {
    return bad(`carrier quoted in currency ${clean(body.currency)}, not ${offering.currency}`);
  }
  const taxMinor = minor(body.taxMinor ?? 0);
  const feesMinor = minor(body.feesMinor ?? 0);
  if (taxMinor === undefined || feesMinor === undefined) return bad("carrier quote has unusable tax or fees");

  // ponytail: `offering.minPremiumMinor` is deliberately NOT applied here. It is
  // a floor on OUR table, and raising a carrier's own binding number would
  // invent a price the underwriter never gave (ADR-0070).
  const until = body.validUntilMs;
  const validUntil =
    Number.isSafeInteger(until) && (until as number) > now && (until as number) < now + YEAR
      ? (until as number)
      : now + WEEK;

  const breakdown = Array.isArray(body.breakdown)
    ? body.breakdown.filter(
        (b): b is { label: string; amountMinor: number } =>
          !!object(b) &&
          typeof (b as { label?: unknown }).label === "string" &&
          Number.isSafeInteger((b as { amountMinor?: unknown }).amountMinor)
      )
    : [];

  const coverage = object(body.coverage) ?? parse<Record<string, unknown>>(offering.coverageJson);

  return {
    ...base,
    state: "quoted",
    premiumMinor,
    taxMinor,
    feesMinor,
    validUntil,
    ...(coverage ? { coverage } : {}),
    ...(breakdown.length ? { breakdown } : {})
  };
}
