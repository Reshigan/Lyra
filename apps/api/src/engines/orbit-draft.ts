import { and, desc, eq, gte, ne } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { verifyGroundedness, type Ctx } from "@lyra/core";
import { promptInstant, type Gateway } from "@lyra/model-gateway";
import { activePrompt, findAgent } from "./ai-agent.js";

// docs/27 F7. The draft loop had two ends and no middle: apps/web's
// conversation.tsx renders a trailing `agent_ai` message with no
// deliveryStatus as a pending draft with approve/discard, and approving
// re-posts it as queued — but the only thing that ever wrote such a row was
// packages/core/src/seed/orbit.ts. This is the producer: a background sweep
// that drafts the next reply for conversations waiting on us.
//
// Draft only, never sent (CLAUDE.md rule 4 — an outbound send is
// consequential, so a human approves it; rule 11 — AI arrives as a background
// draft, never a modal, never an auto-send).

/** The seeded ORBIT drafting agent. No agent row, no sweep — a tenant seeded
 *  before this existed is skipped, not crashed. */
const AGENT_KEY = "service";
const PURPOSE = "orbit.conversation.reply";

/** How far back a conversation can have gone quiet and still get a draft.
 *  Older than this and the reply is archaeology, not service. */
const STALE_MS = 7 * 86_400_000;
const MAX_CONVERSATIONS = 25;
const HISTORY = 12;

/**
 * Draft the next agent reply for every conversation whose newest message is
 * from the customer. Idempotent by construction: writing the draft makes the
 * newest message `agent_ai`, so the next sweep passes over it — which also
 * means a conversation can never accumulate two pending drafts.
 *
 * Returns the number of drafts written.
 */
export async function sweepConversationDrafts(ctx: Ctx, gateway: Gateway): Promise<number> {
  const agent = await findAgent(ctx, AGENT_KEY);
  if (!agent || agent.status !== "active") return 0;

  const conversations = await ctx.db
    .select()
    .from(schema.orbitConversations)
    .where(
      and(
        eq(schema.orbitConversations.tenantId, ctx.tenantId),
        ne(schema.orbitConversations.state, "closed"),
        gte(schema.orbitConversations.lastMessageAt, ctx.now - STALE_MS)
      )
    )
    .orderBy(desc(schema.orbitConversations.lastMessageAt))
    .limit(MAX_CONVERSATIONS);

  let drafted = 0;
  for (const conv of conversations) {
    // One conversation's model failure is not the batch's problem — the next
    // tick tries again, and the guard above means nothing double-drafts.
    try {
      if (await draftReply(ctx, gateway, agent, conv)) drafted += 1;
    } catch {
      // Anything thrown after draftReply opened its run row has already been
      // recorded there as `failed`. Anything thrown before it — building the
      // context — leaves no row at all, so it is invisible here by design:
      // every formatter on that path is total (see `isoDay`) precisely because
      // this catch cannot tell the two cases apart.
    }
  }
  return drafted;
}

type Conversation = typeof schema.orbitConversations.$inferSelect;
type Agent = NonNullable<Awaited<ReturnType<typeof findAgent>>>;

async function draftReply(ctx: Ctx, gateway: Gateway, agent: Agent, conv: Conversation): Promise<boolean> {
  const history = await ctx.db
    .select()
    .from(schema.orbitMessages)
    .where(
      and(eq(schema.orbitMessages.tenantId, ctx.tenantId), eq(schema.orbitMessages.conversationId, conv.id))
    )
    .orderBy(desc(schema.orbitMessages.ts))
    .limit(HISTORY);

  // Newest first. Only a conversation waiting on us gets a draft; anything
  // else already has an answer, a pending draft, or is a system note.
  const newest = history[0];
  if (!newest || newest.role !== "customer") return false;

  const locale = conv.lang === "ar" ? "ar" : "en";
  const lctx: Ctx = { ...ctx, locale };
  const contextLines = await buildContext(lctx, conv, history);

  const runId = newId("air", ctx.now);
  await ctx.db.insert(schema.aiRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    agentKey: agent.key,
    module: "orbit",
    purpose: PURPOSE,
    subjectRef: conv.id,
    actorRef: "system:scheduler",
    autonomyLevel: agent.autonomyLevel,
    trigger: "schedule",
    state: "running",
    inputHash: "",
    startedAt: ctx.now
  });

  try {
    const prompt = await activePrompt(lctx, agent.promptRef);
    const result = await gateway.complete(lctx, {
      module: "orbit",
      purpose: PURPOSE,
      tier: agent.tier as "fast" | "standard" | "reasoning",
      subjectRef: conv.id,
      locale,
      messages: [
        {
          role: "system",
          content:
            `${prompt}\n\n` +
            "Draft the next reply to this customer using only the context lines below. " +
            "Do not state a number that is not in the context. Never say a message, payment or " +
            `change has been made — you are drafting for a human to approve. Reply in ${locale}.\n\n` +
            contextLines.join("\n")
        },
        { role: "user", content: newest.content }
      ]
    });

    // The runtime half of the eval gate (packages/model-gateway/evals/orbit-draft):
    // a reply quoting a premium nobody quoted is worse than no reply, because a
    // busy human approves what reads plausibly. Ungrounded drafts are recorded
    // as refused runs and never reach the inbox.
    const groundedness = verifyGroundedness(result.text, contextLines);
    const text = result.text.trim();
    const ok = groundedness.ok && text.length > 0;

    if (ok) {
      await ctx.db.insert(schema.orbitMessages).values({
        id: newId("omg", ctx.now),
        tenantId: ctx.tenantId,
        conversationId: conv.id,
        role: "agent_ai",
        modality: "text",
        content: text,
        attachmentsJson: null,
        redactionsJson: null,
        aiAuditId: result.auditId,
        // No deliveryStatus: that absence IS the pending-draft state the
        // conversation view reads. Approving sets it to `queued`.
        deliveryStatus: null,
        externalRef: null,
        ts: ctx.now
      } as never);
    }

    await ctx.db
      .update(schema.aiRuns)
      .set({
        state: ok ? "succeeded" : "refused",
        inputHash: result.auditId,
        outputRef: result.auditId,
        confidence: groundedness.ok ? 95 : Math.max(20, 95 - groundedness.mismatches.length * 15),
        evidenceJson: JSON.stringify({
          model: result.model,
          provider: result.provider,
          flags: result.flags,
          mismatches: groundedness.mismatches
        }),
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        costMicro: result.usage.costMicro,
        latencyMs: result.latencyMs,
        endedAt: ctx.now
      })
      .where(and(eq(schema.aiRuns.tenantId, ctx.tenantId), eq(schema.aiRuns.id, runId)));

    return ok;
  } catch (err) {
    await ctx.db
      .update(schema.aiRuns)
      .set({
        state: "failed",
        errorCode: err instanceof Error ? err.message.slice(0, 120) : "error",
        endedAt: ctx.now
      })
      .where(and(eq(schema.aiRuns.tenantId, ctx.tenantId), eq(schema.aiRuns.id, runId)));
    throw err;
  }
}

/**
 * Everything the drafter is allowed to know, as prose. Assembled from the DB
 * rather than from a tool loop on purpose: the same lines are the input to
 * `verifyGroundedness`, so "did the model make this number up" is answerable.
 */
async function buildContext(
  ctx: Ctx,
  conv: Conversation,
  history: readonly (typeof schema.orbitMessages.$inferSelect)[]
): Promise<string[]> {
  // orbit_conversations.customerId is nullable (an inbound message from a
  // handle nobody has matched yet). No customer, no book — the drafter then
  // has only the transcript, which is exactly what a human would have.
  const customerId = conv.customerId;
  const [customer] = customerId
    ? await ctx.db
        .select()
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, customerId)))
        .limit(1)
    : [];

  const policies = customerId
    ? await ctx.db
        .select()
        .from(schema.axisPolicies)
        .where(
          and(eq(schema.axisPolicies.tenantId, ctx.tenantId), eq(schema.axisPolicies.customerId, customerId))
        )
        .orderBy(desc(schema.axisPolicies.endAt))
        .limit(10)
    : [];

  const claims = customerId
    ? await ctx.db
        .select()
        .from(schema.axisClaims)
        .where(and(eq(schema.axisClaims.tenantId, ctx.tenantId), eq(schema.axisClaims.customerId, customerId)))
        .orderBy(desc(schema.axisClaims.reportedAt))
        .limit(5)
    : [];

  const lines: string[] = [
    `Customer ${nameOf(customer?.nameJson, ctx.locale)}, locale ${conv.lang}, ${policies.filter((p) => p.status === "active").length} active policies.`,
    ...(conv.intent ? [`Conversation intent: ${conv.intent}.`] : []),
    ...policies.map(
      (p) =>
        `Policy ${p.policyNo}: status ${p.status}, premium ${p.premiumMinor / 100} ${p.currency}, ` +
        `cover ${isoDay(p.startAt)} to ${isoDay(p.endAt)}.`
    ),
    ...claims.map(
      (cl) =>
        `Claim ${cl.claimNo}: status ${cl.status}, reported ${isoDay(cl.reportedAt)}, ` +
        `reserve ${cl.reserveMinor / 100} ${cl.currency}, paid ${cl.paidMinor / 100} ${cl.currency}.`
    ),
    // Oldest first, so the transcript reads forwards.
    ...[...history].reverse().map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
  ];
  return lines;
}

function nameOf(json: string | null | undefined, locale: string): string {
  if (!json) return "";
  try {
    const map = JSON.parse(json) as Record<string, string>;
    return map[locale] ?? map.en ?? Object.values(map)[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * The day part of an instant, for a line that goes into a prompt. Via
 * `promptInstant` because `new Date(ms).toISOString()` throws outside the Date
 * range, and this runs in `buildContext` — before the aiRuns insert and outside
 * draftReply's try, so a throw here was swallowed by the sweep's catch and the
 * conversation was skipped on every tick with nothing written down.
 *
 * Split on the `T` rather than sliced to 10 characters: ISO-8601 years are not
 * always four digits. An in-range instant far enough from now renders as
 * `-251540-02-03T09:46:40.000Z`, and ten characters of that is `-251540-02` — a
 * month with no day, handed to the model as if it were a whole date.
 * `promptInstant`'s degraded `"unknown"` has no `T` either and survives whole.
 */
const isoDay = (ms: number): string => promptInstant(ms).split("T")[0]!;
