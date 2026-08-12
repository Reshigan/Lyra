import { Hono } from "hono";
import { z } from "zod";
import { schema } from "@lyra/db";
import { badRequest, require_, type Ctx } from "@lyra/core";
import { body } from "../http.js";
import { must } from "../rows.js";
import { dispatchOutbound } from "../engines/orbit-channel-outbound.js";
import { sweepRenewals } from "../engines/renewals.js";
import { sweepRouting } from "../engines/orbit-routing.js";
import { sweepConversationDrafts } from "../engines/orbit-draft.js";
import type { App } from "../env.js";

// docs/16 H3: the AgentRoom Durable Object seam. One room per conversation,
// opened (or continued, if it already lives at that id) on first turn. The
// room itself has no RBAC or tenancy — that is enforced here, at the gateway,
// same as every other route (CLAUDE.md rule 1) — before the DO is ever
// touched.

export const orbitRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

const TurnBody = z.object({
  role: z.enum(["customer", "agent_ai", "agent_human", "system"]),
  content: z.string().min(1).max(20_000),
  modality: z.enum(["text", "voice", "image", "document"]).optional(),
  aiAuditId: z.string().optional()
});

/**
 * Append one turn to a conversation's room. Distinct from the generic
 * `POST /v1/orbit/messages` CRUD create: this goes through the Durable Object
 * so the room can hold in-memory turn state instead of round-tripping the DB
 * per step, checkpointing to `orbit_messages`/`orbit_conversations` itself.
 */
orbitRoutes.post("/conversations/:id/turns", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:messages:send", { tenantId: ctx.tenantId, module: "orbit" });
  const conversationId = c.req.param("id");
  await must(ctx, schema.orbitConversations, conversationId, "conversation");
  const input = await body(c, TurnBody);

  const room = c.env.AGENT_ROOM.get(c.env.AGENT_ROOM.idFromName(`${ctx.tenantId}:${conversationId}`));
  const result = await room.turn({ tenantId: ctx.tenantId, conversationId, ts: ctx.now, ...input });
  return c.json(result, 201);
});

const ReplyBody = z.object({ text: z.string().min(1).max(20_000) });

/**
 * Sends a reply back out over whichever channel the conversation is bound
 * to. Distinct from `POST /messages` (generic CRUD create, no dispatch) and
 * from `/turns` (the AgentRoom path) — this is the human-agent reply path,
 * ADR-0037/ADR-0038's ChannelAdapter.send() the one place it is called from.
 */
orbitRoutes.post("/conversations/:id/reply", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:messages:send", { tenantId: ctx.tenantId, module: "orbit" });
  const conversationId = c.req.param("id");
  const conversation = await must(ctx, schema.orbitConversations, conversationId, "conversation");
  if (!conversation.connectorId) throw badRequest("conversation has no channel connector");
  const connector = await must(ctx, schema.orbitChannelConnectors, conversation.connectorId, "connector");
  const input = await body(c, ReplyBody);

  return c.json(await dispatchOutbound(ctx, c.env, conversation, connector, input.text), 201);
});

/**
 * Force the nightly renewal sweep now. `orbit_renewals` has no `create`
 * permission — a renewal is raised by the sweep, never by a person — and
 * `sweepRenewals` otherwise only runs off the Workers cron tick, so without
 * this an operator (or an e2e test) has no way to put a row in the queue.
 * Same idiom as staff.ts's `/delegations/expire`.
 */
orbitRoutes.post("/renewals/sweep", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:renewals:update", { tenantId: ctx.tenantId, module: "orbit" });
  return c.json({ raised: await sweepRenewals(ctx, c.env.WF) });
});

/**
 * Force the routing sweep now (SLA breach escalation + absence reassignment).
 * Same idiom as `/renewals/sweep` above: this otherwise only runs off the
 * Workers cron tick, so without this an operator (or an e2e test) has no way
 * to force it. Reuses `orbit:conversations:assign` — this endpoint changes
 * exactly the fields that permission already governs (team/assignee),
 * so a new permission would be a distinction without a difference.
 */
orbitRoutes.post("/routing/sweep", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:conversations:assign", { tenantId: ctx.tenantId, module: "orbit" });
  return c.json(await sweepRouting(ctx));
});

/**
 * Force the draft sweep now (docs/27 F7). Same idiom again: the producer of the
 * inbox's pending drafts otherwise only runs off the cron tick, which an
 * operator demoing the approve/discard flow cannot wait for. Needs
 * `ai:invoke` because that is exactly what it does — run an agent — and
 * `conversations:reply` because a draft lands in the transcript.
 */
orbitRoutes.post("/drafts/sweep", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "orbit:ai:invoke", { tenantId: ctx.tenantId, module: "orbit" });
  require_(ctx.actor, "orbit:conversations:reply", { tenantId: ctx.tenantId, module: "orbit" });
  return c.json({ drafted: await sweepConversationDrafts(ctx, c.get("gateway")) });
});
