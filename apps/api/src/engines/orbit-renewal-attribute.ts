import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, emit, type Ctx, type Envelope } from "@lyra/core";

// The retention loop (docs/modules/signal.md §6 consumes
// `orbit.renewal.accepted`; docs/17 SIG-007 — "[∫ORB] Retention campaign
// outcomes attributed to renewals"). ORBIT's renewal campaigns offered,
// nudged and escalated; the QA agent scored the conversations behind them;
// but nothing connected a save back to the work that saved it. The renewal
// row knew *that* it was accepted and the QA rows knew how the conversations
// went, and no row anywhere said "this save came from this campaign's
// outreach, handled at this quality".
//
// This engine is that row. On a renewal outcome (accepted or lost), it looks
// up the conversation(s) ORBIT had with that customer during the campaign
// window, folds in their latest QA score, and emits
// `orbit.renewal.attributed` — the event the quality screen and NORTH read
// to say "retention worked (or didn't), and here is the quality it was
// done at". Attribution you can inspect, not a save-rate asserted from a
// dashboard.

/** How far back from the decision to look for campaign conversations. */
const CAMPAIGN_WINDOW_MS = 45 * 86_400_000;

export interface RenewalAttribution {
  renewalId: string;
  policyRef: string;
  customerId: string;
  outcome: "accepted" | "lost";
  /** Conversations with this customer inside the campaign window. */
  conversationCount: number;
  /** Latest QA score among those conversations; null when none was scored. */
  qaScore: number | null;
  /** The strategy the renewal ran under — auto_requote vs human is exactly
   *  the comparison J-M2's cohort view exists for. */
  strategy: string;
}

/**
 * Fold one renewal outcome into its attribution row and announce it.
 * Returns null when there is nothing to attribute against — a customer with
 * no conversations in the window still gets an attribution event (with zero
 * conversations), because "the customer renewed without talking to us" is
 * itself a fact the quality screen should see, not a gap it should paper over.
 */
export async function onRenewalDecided(ctx: Ctx, envelope: Envelope): Promise<RenewalAttribution | null> {
  const outcome = envelope.type === "orbit.renewal.accepted" ? "accepted" : envelope.type === "orbit.renewal.lost" ? "lost" : null;
  if (!outcome) return null;
  const data = envelope.data as { policyRef?: string; customerId?: string };
  const subject = envelope.subject;
  if (!subject || !data.customerId) return null;

  const [renewal] = await ctx.db
    .select()
    .from(schema.orbitRenewals)
    .where(and(eq(schema.orbitRenewals.tenantId, ctx.tenantId), eq(schema.orbitRenewals.id, subject)))
    .limit(1);
  if (!renewal) return null;

  // Campaign-window conversations with this customer, newest first. The
  // window anchors on the decision: anything ORBIT said to them while the
  // renewal was live is part of the story of how it landed.
  const since = (renewal.decidedAt ?? ctx.now) - CAMPAIGN_WINDOW_MS;
  const conversations = await ctx.db
    .select({ id: schema.orbitConversations.id })
    .from(schema.orbitConversations)
    .where(
      and(
        eq(schema.orbitConversations.tenantId, ctx.tenantId),
        eq(schema.orbitConversations.customerId, data.customerId),
        sql`${schema.orbitConversations.createdAt} >= ${since}`
      )
    )
    .limit(50);

  // Latest QA score across those conversations. A conversation nobody scored
  // contributes nothing rather than a zero — an unscored conversation is not
  // a bad one, and averaging it in would invent quality data.
  let qaScore: number | null = null;
  for (const conv of conversations) {
    const [score] = await ctx.db
      .select({ score: schema.orbitQaScores.score })
      .from(schema.orbitQaScores)
      .where(and(eq(schema.orbitQaScores.tenantId, ctx.tenantId), eq(schema.orbitQaScores.conversationId, conv.id)))
      .orderBy(desc(schema.orbitQaScores.ts))
      .limit(1);
    if (score) {
      qaScore = score.score;
      break;
    }
  }

  const attribution: RenewalAttribution = {
    renewalId: renewal.id,
    policyRef: renewal.policyRef,
    customerId: data.customerId,
    outcome,
    conversationCount: conversations.length,
    qaScore,
    strategy: renewal.strategy
  };

  await emit(ctx, {
    module: "orbit",
    type: "orbit.renewal.attributed",
    subject: renewal.id,
    data: attribution
  });
  await audit(ctx, {
    action: "orbit.renewal.attributed",
    subjectRef: `renewals:${renewal.id}`,
    after: { ...attribution }
  });
  return attribution;
}

/**
 * Save-rate by strategy over a window — what the quality screen reads to
 * compare auto_requote against human handling at a glance. Returns both
 * denominators so a screen can refuse to compare two campaigns whose sample
 * sizes make the comparison noise.
 */
export async function saveRateByStrategy(
  ctx: Ctx,
  since: number
): Promise<Array<{ strategy: string; decided: number; accepted: number }>> {
  const rows = await ctx.db
    .select({
      strategy: schema.orbitRenewals.strategy,
      state: schema.orbitRenewals.state,
      n: sql<number>`count(*)`
    })
    .from(schema.orbitRenewals)
    .where(
      and(
        eq(schema.orbitRenewals.tenantId, ctx.tenantId),
        sql`${schema.orbitRenewals.updatedAt} >= ${since}`,
        sql`${schema.orbitRenewals.state} in ('accepted','lost')`
      )
    )
    .groupBy(schema.orbitRenewals.strategy, schema.orbitRenewals.state);

  const byStrategy = new Map<string, { strategy: string; decided: number; accepted: number }>();
  for (const row of rows) {
    const at =
      byStrategy.get(row.strategy) ?? { strategy: row.strategy, decided: 0, accepted: 0 };
    at.decided += row.n;
    if (row.state === "accepted") at.accepted += row.n;
    byStrategy.set(row.strategy, at);
  }
  return [...byStrategy.values()];
}
