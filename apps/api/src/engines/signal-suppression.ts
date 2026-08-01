import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { id as newId, schema, PurposesJson, parseJson } from "@lyra/db";
import { audit, actorRef, type Ctx, type Envelope } from "@lyra/core";

// docs/25 M4 SIGNAL row — "suppression propagation test": a consumer wired to
// core.consent.updated that refreshes the suppression audience and cascades to
// live campaign membership. Runs inline off the outbox drain (dispatch.ts), so
// consent withdrawal -> suppression is one drain tick, not a 15-minute cron.

export const SUPPRESSION_AUDIENCE_NAME =
  "Do not contact — withdrawn consent, complaints, open claims";

interface ConsentUpdatedData {
  customerId: string;
  purposes?: { marketing?: boolean };
}

/**
 * ponytail: suppression here is consent-only (purposes.marketing === false).
 * The seed's suppression audience also covers complaints and open claims
 * (AXIS case/claim state) — those are a different event's job to add once
 * AXIS emits one; wiring a second cause into the same audience is the upgrade
 * path, not a reason to block this one.
 */
export async function onConsentUpdated(ctx: Ctx, envelope: Envelope): Promise<void> {
  const data = envelope.data as ConsentUpdatedData;
  if (data.purposes?.marketing !== false) return; // only withdrawal suppresses

  const audienceId = await findOrCreateSuppressionAudience(ctx);
  const size = await refreshSuppressionAudience(ctx, audienceId);

  for (const campaignId of await liveCampaignsExcluding(ctx, audienceId)) {
    await audit(ctx, {
      action: "signal.suppression.propagated",
      subjectRef: `signal_campaign:${campaignId}`,
      after: { customerId: data.customerId, audienceId, sizeCached: size }
    });
  }
}

async function findOrCreateSuppressionAudience(ctx: Ctx): Promise<string> {
  const existing = await ctx.db
    .select({ id: schema.signalAudiences.id })
    .from(schema.signalAudiences)
    .where(
      and(
        eq(schema.signalAudiences.tenantId, ctx.tenantId),
        eq(schema.signalAudiences.name, SUPPRESSION_AUDIENCE_NAME)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const id = newId("aud", ctx.now);
  await ctx.db.insert(schema.signalAudiences).values({
    id,
    tenantId: ctx.tenantId,
    name: SUPPRESSION_AUDIENCE_NAME,
    definitionJson: JSON.stringify({
      any: [{ field: "consent.marketing", op: "eq", value: false }]
    }),
    sizeCached: 0,
    refreshPolicy: "hourly",
    consentPurposes: "none",
    createdBy: actorRef(ctx),
    createdAt: ctx.now,
    updatedAt: ctx.now
  });
  return id;
}

/**
 * ponytail: recomputed from ground truth (latest consent row per customer) on
 * every withdrawal instead of incremented — replay-safe with no counter to
 * keep in sync. O(n) over the tenant's consent history; upgrade path is a
 * materialized "latest consent per customer" table if that scan ever shows up
 * in a profile.
 */
async function refreshSuppressionAudience(ctx: Ctx, audienceId: string): Promise<number> {
  const rows = await ctx.db
    .select({ customerId: schema.consents.customerId, purposesJson: schema.consents.purposesJson })
    .from(schema.consents)
    .where(eq(schema.consents.tenantId, ctx.tenantId))
    .orderBy(desc(schema.consents.ts));

  const latestByCustomer = new Map<string, string>();
  for (const row of rows) {
    if (!latestByCustomer.has(row.customerId)) latestByCustomer.set(row.customerId, row.purposesJson);
  }

  let size = 0;
  for (const purposesJson of latestByCustomer.values()) {
    if (parseJson(PurposesJson, purposesJson).marketing === false) size++;
  }

  await ctx.db
    .update(schema.signalAudiences)
    .set({ sizeCached: size, lastRefreshedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(schema.signalAudiences.id, audienceId));
  return size;
}

/** Live campaigns that target the suppression audience directly, or exclude it. */
async function liveCampaignsExcluding(ctx: Ctx, suppressionAudienceId: string): Promise<string[]> {
  const campaigns = await ctx.db
    .select({ id: schema.signalCampaigns.id, audienceId: schema.signalCampaigns.audienceId })
    .from(schema.signalCampaigns)
    .where(
      and(
        eq(schema.signalCampaigns.tenantId, ctx.tenantId),
        eq(schema.signalCampaigns.state, "live"),
        isNull(schema.signalCampaigns.deletedAt)
      )
    );

  const audienceIds = [
    ...new Set(campaigns.map((c) => c.audienceId).filter((id): id is string => id != null))
  ];
  const referencing = new Set<string>([suppressionAudienceId]);
  if (audienceIds.length) {
    const audiences = await ctx.db
      .select({ id: schema.signalAudiences.id, definitionJson: schema.signalAudiences.definitionJson })
      .from(schema.signalAudiences)
      .where(
        and(eq(schema.signalAudiences.tenantId, ctx.tenantId), inArray(schema.signalAudiences.id, audienceIds))
      );
    for (const a of audiences) {
      let excludeAudienceId: unknown;
      try {
        excludeAudienceId = JSON.parse(a.definitionJson)?.excludeAudienceId;
      } catch {
        continue;
      }
      if (excludeAudienceId === suppressionAudienceId) referencing.add(a.id);
    }
  }

  return campaigns.filter((c) => c.audienceId && referencing.has(c.audienceId)).map((c) => c.id);
}
