import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { emit, hasPurpose, type Ctx } from "@lyra/core";
import { parseJson } from "./rating.js";

// Next-best-offer. Cross-sell, upsell, renewal and top-up all answer the same
// question — given what this customer already holds, what should the journey
// surface next — so they are one engine with four kinds rather than four
// half-built ones (docs/05 §6, docs/08 §4).
//
// Two things are load-bearing and are not tunable:
//   1. Nothing is surfaced without the marketing purpose on a live consent.
//   2. Every offer carries an i18n `reasonKey`, never model free text. A
//      customer-facing reason is copy the business signed off on.

/** How many live offers one customer may hold at once. */
export const FREQUENCY_CAP = 3;
const OFFER_TTL_MS = 30 * 86_400_000;
/** A renewal is worth proposing once the policy is inside this window. */
const RENEWAL_WINDOW_MS = 60 * 86_400_000;

export type NboKind = "cross_sell" | "upsell" | "renewal" | "bundle" | "top_up";

export interface Candidate {
  kind: NboKind;
  offeringId: string;
  anchorRef: string;
  score: number;
  expectedValueMinor: number;
  currency: string;
  reasonKey: string;
  reason: Record<string, unknown>;
}

interface Held {
  policyId: string;
  offeringId: string | null;
  productId: string | null;
  premiumMinor: number;
  currency: string;
  endAt: number;
  channelId: string | null;
}

/**
 * Propose offers for one customer. Returns what was written; an empty array
 * means either nothing fits or consent says no, and the caller cannot tell the
 * difference — that is deliberate, a marketing surface has no business knowing
 * a customer's consent state.
 */
export async function proposeOffers(
  ctx: Ctx,
  args: { customerId: string; channelId?: string | undefined; anchorPolicyId?: string | undefined; limit?: number | undefined }
): Promise<(typeof schema.distNextBestOffers.$inferSelect)[]> {
  const allowed = await hasPurpose(ctx, args.customerId, "marketing");
  if (!allowed) {
    await suppress(ctx, args.customerId, "no_consent");
    return [];
  }

  const live = await ctx.db
    .select({ id: schema.distNextBestOffers.id, offeringId: schema.distNextBestOffers.offeringId })
    .from(schema.distNextBestOffers)
    .where(
      and(
        eq(schema.distNextBestOffers.tenantId, ctx.tenantId),
        eq(schema.distNextBestOffers.customerId, args.customerId),
        inArray(schema.distNextBestOffers.state, ["proposed", "surfaced"])
      )
    );
  const room = FREQUENCY_CAP - live.length;
  if (room <= 0) return [];

  const held = await heldPolicies(ctx, args.customerId);
  const candidates = await scoreCandidates(ctx, held, args.anchorPolicyId);

  const alreadyOffered = new Set(live.map((o) => o.offeringId));
  const heldOfferings = new Set(held.map((h) => h.offeringId).filter((v): v is string => !!v));
  const fresh = candidates
    .filter((c) => !alreadyOffered.has(c.offeringId) && !heldOfferings.has(c.offeringId))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(room, args.limit ?? room));

  const written: (typeof schema.distNextBestOffers.$inferSelect)[] = [];
  for (const c of fresh) {
    const row: typeof schema.distNextBestOffers.$inferInsert = {
      id: newId("nbo", ctx.now),
      tenantId: ctx.tenantId,
      customerId: args.customerId,
      kind: c.kind,
      offeringId: c.offeringId,
      anchorRef: c.anchorRef,
      channelId: args.channelId ?? null,
      score: c.score,
      expectedValueMinor: c.expectedValueMinor,
      currency: c.currency,
      reasonKey: c.reasonKey,
      reasonJson: JSON.stringify(c.reason),
      model: "rules/v1",
      state: "proposed",
      expiresAt: ctx.now + OFFER_TTL_MS,
      createdAt: ctx.now,
      updatedAt: ctx.now
    };
    await ctx.db.insert(schema.distNextBestOffers).values(row);
    written.push(row as typeof schema.distNextBestOffers.$inferSelect);
    await emit(ctx, {
      module: "dist",
      type: "dist.nbo.proposed",
      subject: row.id,
      data: { customerId: args.customerId, kind: c.kind, offeringId: c.offeringId, score: c.score }
    });
  }
  return written;
}

async function heldPolicies(ctx: Ctx, customerId: string): Promise<Held[]> {
  const p = schema.axisPolicies;
  const rows = await ctx.db
    .select({
      policyId: p.id,
      offeringId: p.offeringId,
      productId: p.productId,
      premiumMinor: p.premiumMinor,
      currency: p.currency,
      endAt: p.endAt,
      channelId: p.channelId
    })
    .from(p)
    .where(and(eq(p.tenantId, ctx.tenantId), eq(p.customerId, customerId), eq(p.status, "active")))
    .orderBy(desc(p.endAt))
    .limit(50);
  return rows;
}

/**
 * Rules, not a model. Every score here decomposes into named contributions the
 * operator can read back, which is the difference between "we recommended this"
 * and "we can show why we recommended this" when a regulator asks (docs/12 §6).
 *
 * ponytail: rules/v1. The `model` column exists so a learned ranker can take
 * over per tenant later without a schema change; nothing else has to move.
 */
async function scoreCandidates(ctx: Ctx, held: Held[], anchorPolicyId?: string): Promise<Candidate[]> {
  if (!held.length) return [];

  const anchor = anchorPolicyId ? held.find((h) => h.policyId === anchorPolicyId) : undefined;
  const pool = anchor ? [anchor] : held;
  const out: Candidate[] = [];

  const heldOfferingIds = held.map((h) => h.offeringId).filter((v): v is string => !!v);
  const heldOfferings = heldOfferingIds.length
    ? await ctx.db
        .select()
        .from(schema.distOfferings)
        .where(
          and(
            eq(schema.distOfferings.tenantId, ctx.tenantId),
            inArray(schema.distOfferings.id, heldOfferingIds)
          )
        )
    : [];
  const byId = new Map(heldOfferings.map((o) => [o.id, o]));

  const live = await ctx.db
    .select()
    .from(schema.distOfferings)
    .where(
      and(
        eq(schema.distOfferings.tenantId, ctx.tenantId),
        eq(schema.distOfferings.status, "active"),
        isNull(schema.distOfferings.deletedAt),
        lte(schema.distOfferings.effectiveFrom, ctx.now),
        or(isNull(schema.distOfferings.effectiveTo), gt(schema.distOfferings.effectiveTo, ctx.now))
      )
    );

  for (const h of pool) {
    const anchorOffering = h.offeringId ? byId.get(h.offeringId) : undefined;

    // Renewal: the cheapest offer to make and the most likely to convert, so it
    // outranks everything else inside the window.
    const daysLeft = Math.round((h.endAt - ctx.now) / 86_400_000);
    if (h.endAt - ctx.now <= RENEWAL_WINDOW_MS && h.endAt > ctx.now && h.offeringId) {
      out.push({
        kind: "renewal",
        offeringId: h.offeringId,
        anchorRef: h.policyId,
        score: Math.min(95, 70 + Math.max(0, 30 - daysLeft)),
        expectedValueMinor: h.premiumMinor,
        currency: h.currency,
        reasonKey: "nbo.reason.renewal_due",
        reason: { policyId: h.policyId, daysLeft }
      });
    }

    for (const o of live) {
      if (o.id === h.offeringId) continue;

      // Upsell: the offering explicitly declares itself a step up from this one.
      if (o.upsellOfOfferingId && o.upsellOfOfferingId === h.offeringId) {
        const uplift = Math.max(0, (o.minPremiumMinor ?? h.premiumMinor) - h.premiumMinor);
        out.push({
          kind: "upsell",
          offeringId: o.id,
          anchorRef: h.policyId,
          score: 78,
          expectedValueMinor: uplift || Math.floor(h.premiumMinor * 0.25),
          currency: o.currency,
          reasonKey: "nbo.reason.upgrade_available",
          reason: { from: h.offeringId, policyId: h.policyId }
        });
        continue;
      }

      // Cross-sell: tag overlap with what they hold, different product line.
      if (o.productId && o.productId !== h.productId) {
        const theirs = new Set(parseJson<string[]>(anchorOffering?.crossSellTagsJson ?? null) ?? []);
        const mine = parseJson<string[]>(o.crossSellTagsJson) ?? [];
        const shared = mine.filter((t) => theirs.has(t));
        if (!shared.length) continue;
        // Tag overlap is the whole signal, so the score is the overlap, floored
        // low enough that a single shared tag stays below any renewal.
        const score = Math.min(72, 40 + shared.length * 10);
        out.push({
          kind: shared.length >= 3 ? "bundle" : "cross_sell",
          offeringId: o.id,
          anchorRef: h.policyId,
          score,
          expectedValueMinor: o.minPremiumMinor ?? 0,
          currency: o.currency,
          reasonKey: shared.length >= 3 ? "nbo.reason.bundle_fit" : "nbo.reason.complements_cover",
          reason: { tags: shared, policyId: h.policyId }
        });
      }
    }
  }

  // One offer per offering: the highest-scoring anchor wins.
  const best = new Map<string, Candidate>();
  for (const c of out) {
    const prior = best.get(c.offeringId);
    if (!prior || c.score > prior.score) best.set(c.offeringId, c);
  }
  return [...best.values()];
}

/** Consent withdrawn or capped: kill the live offers rather than leaving them to expire. */
async function suppress(ctx: Ctx, customerId: string, reason: string): Promise<void> {
  await ctx.db
    .update(schema.distNextBestOffers)
    .set({ state: "suppressed", suppressReason: reason, decidedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(schema.distNextBestOffers.tenantId, ctx.tenantId),
        eq(schema.distNextBestOffers.customerId, customerId),
        inArray(schema.distNextBestOffers.state, ["proposed", "surfaced"])
      )
    );
}

/** Journey surfaces call this when an offer is actually shown, so caps are honest. */
export async function markSurfaced(ctx: Ctx, offerId: string): Promise<void> {
  await ctx.db
    .update(schema.distNextBestOffers)
    .set({ state: "surfaced", surfacedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(schema.distNextBestOffers.tenantId, ctx.tenantId),
        eq(schema.distNextBestOffers.id, offerId),
        eq(schema.distNextBestOffers.state, "proposed")
      )
    );
}

export async function decideOffer(
  ctx: Ctx,
  offerId: string,
  decision: "accepted" | "dismissed",
  quoteRequestId?: string
): Promise<void> {
  await ctx.db
    .update(schema.distNextBestOffers)
    .set({
      state: decision,
      decidedAt: ctx.now,
      updatedAt: ctx.now,
      ...(quoteRequestId ? { convertedRequestId: quoteRequestId } : {})
    })
    .where(
      and(
        eq(schema.distNextBestOffers.tenantId, ctx.tenantId),
        eq(schema.distNextBestOffers.id, offerId)
      )
    );
  await emit(ctx, {
    module: "dist",
    type: `dist.nbo.${decision}`,
    subject: offerId,
    data: { offerId, quoteRequestId }
  });
}

/** Cron sweep: offers past their TTL stop counting against the cap. */
export async function expireOffers(ctx: Ctx): Promise<void> {
  await ctx.db
    .update(schema.distNextBestOffers)
    .set({ state: "expired", updatedAt: ctx.now })
    .where(
      and(
        eq(schema.distNextBestOffers.tenantId, ctx.tenantId),
        inArray(schema.distNextBestOffers.state, ["proposed", "surfaced"]),
        lte(schema.distNextBestOffers.expiresAt, ctx.now)
      )
    );
}
