import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { schema } from "@lyra/db";
import { badRequest, quoteCommission, type Ctx } from "@lyra/core";

// The rating engine. An aggregator's whole value is here: take one risk, price it
// against every eligible offering on the panel, and rank the answers. Pricing
// comes from three places — a live underwriter API, a rate table we hold, or a
// human — and the caller cannot tell which, because the comparison must not
// depend on how the number was obtained (docs/05 §4).

/* ------------------------------------------------------------- eligibility */

export interface Eligibility {
  minAge?: number;
  maxAge?: number;
  markets?: string[];
  minSumInsuredMinor?: number;
  maxSumInsuredMinor?: number;
  /** Arbitrary equality gates, e.g. {vehicleUse: "private"}. */
  requires?: Record<string, string | number | boolean>;
  excludes?: Record<string, string | number | boolean>;
}

export interface Ineligible {
  rule: string;
  detail: string;
}

/**
 * Every failing rule, not just the first. An operator explaining why a panel of
 * nine returned two quotes needs the whole list, and "age" alone is not an answer.
 */
export function checkEligibility(
  rules: Eligibility | null,
  inputs: Record<string, unknown>
): Ineligible[] {
  if (!rules) return [];
  const out: Ineligible[] = [];
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

  const age = num(inputs.age);
  if (rules.minAge !== undefined && (age === undefined || age < rules.minAge)) {
    out.push({ rule: "minAge", detail: `age ${age ?? "missing"} < ${rules.minAge}` });
  }
  if (rules.maxAge !== undefined && age !== undefined && age > rules.maxAge) {
    out.push({ rule: "maxAge", detail: `age ${age} > ${rules.maxAge}` });
  }

  if (rules.markets?.length) {
    const market = typeof inputs.market === "string" ? inputs.market : undefined;
    if (!market || !rules.markets.includes(market)) {
      out.push({ rule: "market", detail: `${market ?? "missing"} not in ${rules.markets.join(",")}` });
    }
  }

  const sum = num(inputs.sumInsuredMinor);
  if (rules.minSumInsuredMinor !== undefined && (sum === undefined || sum < rules.minSumInsuredMinor)) {
    out.push({ rule: "minSumInsured", detail: `${sum ?? "missing"} < ${rules.minSumInsuredMinor}` });
  }
  if (rules.maxSumInsuredMinor !== undefined && sum !== undefined && sum > rules.maxSumInsuredMinor) {
    out.push({ rule: "maxSumInsured", detail: `${sum} > ${rules.maxSumInsuredMinor}` });
  }

  for (const [k, want] of Object.entries(rules.requires ?? {})) {
    if (inputs[k] !== want) out.push({ rule: `requires.${k}`, detail: `expected ${String(want)}` });
  }
  for (const [k, banned] of Object.entries(rules.excludes ?? {})) {
    if (inputs[k] === banned) out.push({ rule: `excludes.${k}`, detail: `${k} must not be ${String(banned)}` });
  }
  return out;
}

/* ----------------------------------------------------------------- pricing */

/**
 * A rate table: ordered bands, first match wins, factors multiply.
 *
 *   { base: 120000, bands: [{ field: "age", min: 18, max: 24, factorPpm: 1_450_000 }],
 *     rates: [{ field: "sumInsuredMinor", ratePpm: 8500 }], minPremiumMinor: 50000 }
 *
 * ponytail: bands and multiplicative factors cover motor, health and travel as
 * priced today. A table that needs its own expression language is a sign the
 * underwriter should be on `pricingMode: "api"` instead.
 */
export interface RateTable {
  base?: number;
  bands?: {
    field: string;
    min?: number;
    max?: number;
    equals?: string | number | boolean;
    factorPpm?: number;
    addMinor?: number;
  }[];
  /** Premium components proportional to an input, e.g. rate on sum insured. */
  rates?: { field: string; ratePpm: number }[];
  loadings?: { field: string; whenTrue: number }[];
  minPremiumMinor?: number;
  taxPpm?: number;
}

const PPM = 1_000_000;

export interface Priced {
  premiumMinor: number;
  taxMinor: number;
  feesMinor: number;
  /** Which rule contributed what — shown in the operator's "why this price" panel. */
  breakdown: { label: string; amountMinor: number }[];
}

export function priceFromTable(table: RateTable, inputs: Record<string, unknown>): Priced {
  const num = (f: string): number => {
    const v = inputs[f];
    return typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0;
  };

  const breakdown: { label: string; amountMinor: number }[] = [];
  let premium = table.base ?? 0;
  if (premium) breakdown.push({ label: "base", amountMinor: premium });

  for (const rate of table.rates ?? []) {
    const part = Math.floor((num(rate.field) * rate.ratePpm) / PPM);
    if (part) {
      premium += part;
      breakdown.push({ label: `rate.${rate.field}`, amountMinor: part });
    }
  }

  // Bands are ordered and the first match per field wins, so a table can express
  // "18-24 pays 1.45x" without every later band re-stating the exclusion.
  const usedFields = new Set<string>();
  for (const band of table.bands ?? []) {
    if (usedFields.has(band.field)) continue;
    const v = inputs[band.field];
    const n = typeof v === "number" ? v : Number(v);
    const matches =
      band.equals !== undefined
        ? v === band.equals
        : Number.isFinite(n) &&
          (band.min === undefined || n >= band.min) &&
          (band.max === undefined || n <= band.max);
    if (!matches) continue;
    usedFields.add(band.field);
    if (band.factorPpm !== undefined) {
      const before = premium;
      premium = Math.floor((premium * band.factorPpm) / PPM);
      breakdown.push({ label: `band.${band.field}`, amountMinor: premium - before });
    }
    if (band.addMinor) {
      premium += band.addMinor;
      breakdown.push({ label: `band.${band.field}.add`, amountMinor: band.addMinor });
    }
  }

  for (const loading of table.loadings ?? []) {
    if (inputs[loading.field] === true || inputs[loading.field] === "true") {
      premium += loading.whenTrue;
      breakdown.push({ label: `loading.${loading.field}`, amountMinor: loading.whenTrue });
    }
  }

  if (table.minPremiumMinor !== undefined && premium < table.minPremiumMinor) {
    breakdown.push({ label: "minPremium", amountMinor: table.minPremiumMinor - premium });
    premium = table.minPremiumMinor;
  }

  const taxMinor = Math.floor((premium * (table.taxPpm ?? 0)) / PPM);
  return { premiumMinor: premium, taxMinor, feesMinor: 0, breakdown };
}

/* --------------------------------------------------------------- value score */

export interface ScoreInput {
  premiumMinor: number;
  cheapestMinor: number;
  dearestMinor: number;
  /** Count of benefits present versus the richest offer on the panel. */
  coverageCount: number;
  bestCoverageCount: number;
  /** Provider service rating 0-100, from orbit_partners/provider scorecards. */
  providerScore?: number;
}

/**
 * Price and cover on one 0-100 axis. Deliberately arithmetic rather than a model
 * call: a customer-facing ranking has to be explainable line by line, and a
 * regulator asking "why was this one recommended" gets the weights, not a
 * embedding. The AI's job is the rationale copy, not the ordering.
 */
export function valueScore(s: ScoreInput): number {
  const span = Math.max(1, s.dearestMinor - s.cheapestMinor);
  const priceScore = 100 - Math.round(((s.premiumMinor - s.cheapestMinor) / span) * 100);
  const coverScore = s.bestCoverageCount > 0 ? Math.round((s.coverageCount / s.bestCoverageCount) * 100) : 0;
  const service = s.providerScore ?? 70;
  const raw = priceScore * 0.5 + coverScore * 0.35 + service * 0.15;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/* -------------------------------------------------------------- the fan-out */

export interface PanelEntry {
  offering: typeof schema.distOfferings.$inferSelect;
  provider: typeof schema.providers.$inferSelect | undefined;
}

/** Offerings that may be quoted for this product, on this channel, right now. */
export async function panelFor(
  ctx: Ctx,
  args: { productId: string; channelKey: string; at?: number }
): Promise<PanelEntry[]> {
  const at = args.at ?? ctx.now;
  const t = schema.distOfferings;
  const rows = await ctx.db
    .select({ offering: t, provider: schema.providers })
    .from(t)
    .leftJoin(
      schema.providers,
      and(eq(schema.providers.id, t.providerId), eq(schema.providers.tenantId, t.tenantId))
    )
    .where(
      and(
        eq(t.tenantId, ctx.tenantId),
        eq(t.productId, args.productId),
        eq(t.status, "active"),
        isNull(t.deletedAt),
        lte(t.effectiveFrom, at),
        or(isNull(t.effectiveTo), gt(t.effectiveTo, at))
      )
    );

  return rows
    .filter(({ offering }) => {
      // null channelKeysJson means "every channel" — the common case, so it is
      // the default rather than something each offering has to opt into.
      if (!offering.channelKeysJson) return true;
      try {
        const keys = JSON.parse(offering.channelKeysJson) as string[];
        return !keys.length || keys.includes(args.channelKey);
      } catch {
        return false;
      }
    })
    .map(({ offering, provider }) => ({ offering, provider: provider ?? undefined }));
}

export interface QuoteOutcome {
  offeringId: string;
  providerId: string;
  state: "quoted" | "declined" | "referred" | "timeout" | "error";
  premiumMinor?: number;
  taxMinor: number;
  feesMinor: number;
  currency: string;
  coverage?: Record<string, unknown>;
  declineReason?: string;
  latencyMs: number;
  validUntil?: number;
  breakdown?: { label: string; amountMinor: number }[];
}

/** Live underwriter APIs live behind this; on-prem and tests inject a stub. */
export interface ProviderQuoter {
  (args: {
    offering: typeof schema.distOfferings.$inferSelect;
    inputs: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<Omit<QuoteOutcome, "offeringId" | "providerId" | "latencyMs">>;
}

/**
 * Price one offering. Never throws: a provider being down is a `state: "error"`
 * row on the comparison, not a failed shop for the other eight.
 */
export async function quoteOne(
  ctx: Ctx,
  entry: PanelEntry,
  inputs: Record<string, unknown>,
  quoter?: ProviderQuoter
): Promise<QuoteOutcome> {
  const started = Date.now();
  const { offering } = entry;
  const base = {
    offeringId: offering.id,
    providerId: offering.providerId,
    taxMinor: 0,
    feesMinor: 0,
    currency: offering.currency
  };

  const fail = (state: QuoteOutcome["state"], reason: string): QuoteOutcome => ({
    ...base,
    state,
    declineReason: reason,
    latencyMs: Date.now() - started
  });

  const rules = parseJson<Eligibility>(offering.eligibilityJson);
  const failures = checkEligibility(rules, inputs);
  if (failures.length) return fail("declined", failures.map((f) => f.rule).join(","));

  try {
    switch (offering.pricingMode) {
      case "table": {
        const table = parseJson<RateTable>(offering.ratingTableJson);
        if (!table) return fail("error", "offering has no rate table");
        const priced = priceFromTable(table, inputs);
        if (offering.minPremiumMinor !== null && priced.premiumMinor < offering.minPremiumMinor) {
          priced.premiumMinor = offering.minPremiumMinor;
        }
        return {
          ...base,
          state: "quoted",
          premiumMinor: priced.premiumMinor,
          taxMinor: priced.taxMinor,
          feesMinor: priced.feesMinor,
          breakdown: priced.breakdown,
          ...(parseJson<Record<string, unknown>>(offering.coverageJson)
            ? { coverage: parseJson<Record<string, unknown>>(offering.coverageJson) as Record<string, unknown> }
            : {}),
          validUntil: ctx.now + 7 * 86_400_000,
          latencyMs: Date.now() - started
        };
      }
      case "api": {
        if (!quoter) return fail("error", "no provider adapter configured");
        const res = await quoter({ offering, inputs, timeoutMs: offering.slaSeconds * 1000 });
        return { ...base, ...res, latencyMs: Date.now() - started };
      }
      case "manual":
      case "referral":
        // Not an error: the panel legitimately contains underwriters who answer
        // by email. The row exists so the operator can chase it.
        return fail("referred", offering.pricingMode);
      default:
        return fail("error", `unknown pricing mode ${offering.pricingMode}`);
    }
  } catch (e) {
    return fail("error", String(e).slice(0, 200));
  }
}

/**
 * Rank a completed fan-out and stamp what we would earn on each. Commission is
 * resolved once here and stored on the response, because the rate in force can
 * change between quote and bind and the customer was shown this one.
 */
export async function rankOutcomes(
  ctx: Ctx,
  outcomes: QuoteOutcome[],
  args: { channelId: string; providerScores?: Record<string, number> }
): Promise<(QuoteOutcome & { priceRank?: number; valueScore?: number; commission?: Awaited<ReturnType<typeof quoteCommission>> })[]> {
  const quoted = outcomes.filter(
    (o): o is QuoteOutcome & { premiumMinor: number } => o.state === "quoted" && typeof o.premiumMinor === "number"
  );
  if (!quoted.length) return outcomes;

  const totals = quoted.map((o) => o.premiumMinor + o.taxMinor + o.feesMinor);
  const cheapest = Math.min(...totals);
  const dearest = Math.max(...totals);
  const bestCoverage = Math.max(...quoted.map((o) => Object.keys(o.coverage ?? {}).length), 1);

  const ranked = [...quoted].sort(
    (a, b) => a.premiumMinor + a.taxMinor + a.feesMinor - (b.premiumMinor + b.taxMinor + b.feesMinor)
  );

  const out: (QuoteOutcome & {
    priceRank?: number;
    valueScore?: number;
    commission?: Awaited<ReturnType<typeof quoteCommission>>;
  })[] = [];
  for (const o of outcomes) {
    if (o.state !== "quoted" || typeof o.premiumMinor !== "number") {
      out.push(o);
      continue;
    }
    const total = o.premiumMinor + o.taxMinor + o.feesMinor;
    const commission = await quoteCommission(ctx, {
      offeringId: o.offeringId,
      channelId: args.channelId,
      premiumMinor: o.premiumMinor
    });
    out.push({
      ...o,
      priceRank: ranked.findIndex((r) => r.offeringId === o.offeringId) + 1,
      valueScore: valueScore({
        premiumMinor: total,
        cheapestMinor: cheapest,
        dearestMinor: dearest,
        coverageCount: Object.keys(o.coverage ?? {}).length,
        bestCoverageCount: bestCoverage,
        ...(args.providerScores?.[o.providerId] !== undefined
          ? { providerScore: args.providerScores[o.providerId] as number }
          : {})
      }),
      commission
    });
  }
  return out;
}

export function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Rating inputs the offering declares as required, checked before we fan out. */
export function assertInputs(offerings: PanelEntry[], inputs: Record<string, unknown>): void {
  const required = new Set<string>();
  for (const { offering } of offerings) {
    const decl = parseJson<{ required?: string[] }>(offering.ratingInputsJson);
    for (const f of decl?.required ?? []) required.add(f);
  }
  const missing = [...required].filter((f) => inputs[f] === undefined || inputs[f] === "");
  // Missing a field only one underwriter wants must not block the shop; missing
  // one that every underwriter wants means there is nothing to compare.
  if (missing.length && missing.length === required.size) {
    throw badRequest(`rating inputs missing: ${missing.join(", ")}`);
  }
}
