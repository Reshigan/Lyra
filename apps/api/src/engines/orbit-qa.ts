import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { audit, type Ctx } from "@lyra/core";
import { CX_JUDGE_VERSION, cxJudgePrompt, parseCxDimensions, type Gateway } from "@lyra/model-gateway";
import { agentByKey } from "./ai-agent.js";

// The QA half of ORBIT §2.1's promise: "QA agent scores 100% of
// conversations (resolution, tone, compliance phrases); samples routed to
// Team Lead review; scores feed coaching." The `qa` agent row was seeded and
// `orbit_qa_scores` existed for hand-entry, but nothing ever scored a
// conversation on its own — the table only ever held what a human typed.
//
// This sweep is the agent. Each tick it takes the closed conversations that
// have no QA score yet, sends the transcript through the cx-judge rubric
// (docs/13 §3.4 — the same frozen judge the eval gate uses), and writes one
// score per conversation. Scores land under `agent:qa`, so the existing
// Team Lead review lane and the coaching reads work unchanged.

/** How many unscored conversations one tick handles. */
const BATCH = 20;

/** Transcript lines sent to the judge, oldest first. */
const TRANSCRIPT_LIMIT = 40;

/**
 * Score every closed conversation that has no QA score yet. Returns the
 * number of conversations scored this tick.
 *
 * Judge failures are per-conversation: one bad reply skips that conversation
 * until the next tick rather than failing the batch — an unscored
 * conversation is retried by design, a poisoned one must not block the rest.
 */
export async function sweepQaScores(ctx: Ctx, gateway: Gateway): Promise<number> {
  const agent = await agentByKey(ctx, "qa");

  // Closed conversations with at least one message, minus anything already
  // scored. "Closed" is the right trigger: scoring mid-flight would judge a
  // story that has not ended.
  const scored = ctx.db
    .select({ conversationId: schema.orbitQaScores.conversationId })
    .from(schema.orbitQaScores)
    .where(eq(schema.orbitQaScores.tenantId, ctx.tenantId));

  const candidates = await ctx.db
    .select({ id: schema.orbitConversations.id, lang: schema.orbitConversations.lang })
    .from(schema.orbitConversations)
    .where(
      and(
        eq(schema.orbitConversations.tenantId, ctx.tenantId),
        eq(schema.orbitConversations.state, "closed"),
        // At least one customer message — a conversation with nothing said
        // has nothing to judge.
        sql`exists (select 1 from ${schema.orbitMessages} m where m.conversation_id = ${schema.orbitConversations.id} and m.role = 'customer')`,
        notInArray(schema.orbitConversations.id, scored)
      )
    )
    .orderBy(desc(schema.orbitConversations.lastMessageAt))
    .limit(BATCH);

  if (!candidates.length) return 0;

  const transcripts = await loadTranscripts(ctx, candidates.map((c) => c.id));

  let scoredCount = 0;
  for (const conv of candidates) {
    const transcript = transcripts.get(conv.id);
    if (!transcript || !transcript.reply) continue;

    try {
      const res = await gateway.complete(ctx, {
        module: "orbit",
        purpose: "output.review",
        tier: agent.tier as "fast" | "standard" | "reasoning",
        subjectRef: conv.id,
        locale: conv.lang,
        messages: [
          { role: "system", content: await promptOf(ctx, agent) },
          { role: "user", content: cxJudgePrompt({ locale: conv.lang, context: transcript.context, reply: transcript.reply }) }
        ]
      });
      const judged = parseCxDimensions(res.text);
      if (judged === null) continue;
      const score5 = judged.score;

      // Rubric is 1..5; the column stores 0..100 so both scales coexist
      // without a second column.
      const score100 = Math.round((score5 / 5) * 100);

      await ctx.db.insert(schema.orbitQaScores).values({
        id: newId("qas", ctx.now),
        tenantId: ctx.tenantId,
        conversationId: conv.id,
        rubricKey: "cx_judge",
        score: score100,
        // ADR-0074 §2: the per-dimension scores are the reason a reply scored
        // what it did. v1 stored the composite alone, so a reviewer could not
        // tell a weak reply from an inaccurate one — and the composite now
        // caps at accuracy, which is only legible with the breakdown beside it.
        breakdownJson: JSON.stringify({
          judgeVersion: CX_JUDGE_VERSION,
          score5,
          dimensions: judged.dimensions,
          ...(judged.why ? { why: judged.why } : {})
        }),
        scoredBy: "agent:qa",
        ts: ctx.now
      });
      scoredCount++;
    } catch {
      // Per-conversation skip: retried next tick.
      continue;
    }
  }

  if (scoredCount > 0) {
    await audit(ctx, {
      action: "orbit.qa.sweep",
      subjectRef: `qa_scores:sweep:${ctx.now}`,
      after: { scored: scoredCount, considered: candidates.length }
    });
  }
  return scoredCount;
}

async function promptOf(ctx: Ctx, agent: { promptRef: string | null }): Promise<string> {
  if (!agent.promptRef) return "";
  const [row] = await ctx.db
    .select({ body: schema.aiPrompts.body })
    .from(schema.aiPrompts)
    .where(and(eq(schema.aiPrompts.tenantId, ctx.tenantId), eq(schema.aiPrompts.id, agent.promptRef)))
    .limit(1);
  return row?.body ?? "";
}

/** Newest-first messages folded into a judge-ready transcript: the
 *  conversation as context lines, the last agent reply as the reply under
 *  evaluation. A conversation with no agent reply cannot be judged for
 *  quality of reply — skipped by returning no reply. */
async function loadTranscripts(ctx: Ctx, conversationIds: string[]): Promise<Map<string, { context: string[]; reply: string | null }>> {
  if (!conversationIds.length) return new Map();
  const messages = await ctx.db
    .select({
      conversationId: schema.orbitMessages.conversationId,
      role: schema.orbitMessages.role,
      content: schema.orbitMessages.content,
      ts: schema.orbitMessages.ts
    })
    .from(schema.orbitMessages)
    .where(and(eq(schema.orbitMessages.tenantId, ctx.tenantId), inArray(schema.orbitMessages.conversationId, conversationIds)))
    .orderBy(desc(schema.orbitMessages.ts));

  const out = new Map<string, { context: string[]; reply: string | null }>();
  const perConv = new Map<string, Array<{ role: string; content: string; ts: number }>>();
  for (const m of messages) {
    const list = perConv.get(m.conversationId) ?? [];
    list.push({ role: m.role, content: m.content, ts: m.ts });
    perConv.set(m.conversationId, list);
  }
  for (const [convId, list] of perConv) {
    const chrono = [...list].reverse(); // oldest first
    const context = chrono.slice(-TRANSCRIPT_LIMIT).map((m) => `${m.role}: ${m.content}`);
    const lastAgentReply = [...chrono].reverse().find((m) => m.role === "agent_human" || m.role === "agent_ai");
    out.set(convId, {
      context,
      reply: lastAgentReply?.content ?? null
    });
  }
  return out;
}
