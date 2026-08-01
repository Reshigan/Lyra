import { eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { AppError, badRequest, gate, hashObject, notFound, scoped, sha256Hex, type Ctx } from "@lyra/core";
import type { Message, ToolCall, ToolDef } from "@lyra/model-gateway";

// docs/15. The seam between "the model wants X" and "X actually happened":
// ORBIT's agent gets tool defs from ORBIT_TOOL_DEFS and every call the model
// makes is dispatched through runOrbitTool, never executed inline in the AI
// route. Reads are direct scoped() queries (fetch_policy, the intake half of
// start_quote); the one action that touches contractual state
// (create_endorsement_request) goes through the pre-existing axis.endorse
// approval policy before anything is written (CLAUDE.md rule 4).

export const ORBIT_TOOL_DEFS: ToolDef[] = [
  {
    name: "fetch_policy",
    description: "Look up an AXIS policy by id or policy number.",
    parameters: {
      type: "object",
      properties: {
        policyId: { type: "string" },
        policyNo: { type: "string" }
      }
    },
    consequential: false
  },
  {
    name: "start_quote",
    description: "Open a new AXIS quote case (intake) for a customer.",
    parameters: {
      type: "object",
      properties: {
        customerId: { type: "string" },
        productLine: { type: "string" },
        channelId: { type: "string" }
      },
      required: ["customerId"]
    },
    consequential: false
  },
  {
    name: "create_endorsement_request",
    description:
      "Request a change to an existing policy. Contractual state, so this does not take effect until the request is approved.",
    parameters: {
      type: "object",
      properties: {
        policyId: { type: "string" },
        changes: { type: "object" },
        reason: { type: "string" },
        premiumDeltaMinor: { type: "number" }
      },
      required: ["policyId", "changes"]
    },
    consequential: true
  }
];

type ToolHandler = (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

async function fetchPolicy(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const policyId = str(args.policyId);
  const policyNo = str(args.policyNo);
  if (!policyId && !policyNo) throw badRequest("fetch_policy needs policyId or policyNo");

  const rows = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(
      scoped(
        ctx,
        schema.axisPolicies,
        policyId ? eq(schema.axisPolicies.id, policyId) : eq(schema.axisPolicies.policyNo, policyNo!)
      )
    )
    .limit(1);
  const policy = rows[0];
  if (!policy) throw notFound("policy");
  return policy;
}

async function startQuote(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const customerId = str(args.customerId);
  if (!customerId) throw badRequest("start_quote needs customerId");

  const caseId = newId("cas", ctx.now);
  // ponytail: id() is already unique per tenant, so the case reuses it as its
  // human-facing ref too. Swap in a real short-code generator (none exists
  // yet — seed.ts hardcodes its one ref) if agents start surfacing refs to
  // customers directly.
  const row = {
    id: caseId,
    tenantId: ctx.tenantId,
    ref: caseId,
    kind: "quote",
    customerId,
    productLine: str(args.productLine) ?? null,
    channelId: str(args.channelId) ?? null,
    status: "intake",
    ownerRef: `${ctx.actor.kind}:${ctx.actor.id}`,
    source: "agent",
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisCases).values(row);
  return row;
}

async function createEndorsementRequest(ctx: Ctx, args: Record<string, unknown>): Promise<unknown> {
  const policyId = str(args.policyId);
  if (!policyId) throw badRequest("create_endorsement_request needs policyId");
  const changes = args.changes && typeof args.changes === "object" ? (args.changes as Record<string, unknown>) : undefined;
  if (!changes || Object.keys(changes).length === 0) throw badRequest("create_endorsement_request needs changes");
  const reason = str(args.reason) ?? null;
  const premiumDeltaMinor = typeof args.premiumDeltaMinor === "number" ? args.premiumDeltaMinor : undefined;

  const policyRows = await ctx.db
    .select()
    .from(schema.axisPolicies)
    .where(scoped(ctx, schema.axisPolicies, eq(schema.axisPolicies.id, policyId)))
    .limit(1);
  const policy = policyRows[0];
  if (!policy) throw notFound("policy");

  // No dedicated endorsement table exists (docs/03 AXIS): an endorsement
  // request is an axis_cases row of kind "endorse", same as bind/renewal_ops.
  // Distinct change-sets get distinct approval identities so two different
  // asks against the same policy do not collide on one pending approval, but
  // a retry of the same ask reuses it (mirrors crud.ts's `path:new:hash`).
  const subjectRef = `axis_endorse:${policyId}:${await sha256Hex(JSON.stringify({ changes, reason }))}`;
  await gate(ctx, {
    policyKey: "axis.endorse",
    subjectRef,
    ...(premiumDeltaMinor !== undefined ? { amountMinor: Math.abs(premiumDeltaMinor) } : {}),
    context: { policyId, changes, reason }
  });

  const caseId = newId("cas", ctx.now);
  const row = {
    id: caseId,
    tenantId: ctx.tenantId,
    ref: caseId,
    kind: "endorse",
    customerId: policy.customerId,
    status: "review",
    ownerRef: `${ctx.actor.kind}:${ctx.actor.id}`,
    source: "agent",
    metaJson: JSON.stringify({ policyId, changes, reason }),
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.axisCases).values(row);
  return row;
}

const HANDLERS: Record<string, ToolHandler> = {
  fetch_policy: fetchPolicy,
  start_quote: startQuote,
  create_endorsement_request: createEndorsementRequest
};

export function isOrbitTool(name: string): boolean {
  return name in HANDLERS;
}

export async function runOrbitTool(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) throw notFound(`tool ${name}`);
  return handler(ctx, args);
}

/**
 * Execute every tool call the model asked for, record one `ai_tool_calls` row
 * each (outcome + approval id, never the raw content — docs/12 §4) and hand
 * back `role: tool` messages so the AI route can fold them into a follow-up
 * completion. A gated call never throws out of here: `approval_required`
 * becomes an `awaiting_approval` row and a tool result the model can react to,
 * so one blocked action does not fail the whole run.
 */
export async function executeOrbitToolCalls(
  ctx: Ctx,
  runId: string,
  toolCalls: ToolCall[],
  allowed: ReadonlySet<string>
): Promise<Message[]> {
  const messages: Message[] = [];
  let seq = 0;
  for (const call of toolCalls) {
    const def = ORBIT_TOOL_DEFS.find((d) => d.name === call.name);
    const startedAt = Date.now();
    let outcome: "ok" | "error" | "awaiting_approval" = "ok";
    let approvalId: string | null = null;
    let result: unknown;
    try {
      // The model is only ever offered `orbitToolsFor(agent)` (ai.ts), but a
      // completion can echo back a tool call outside that set — an injected
      // instruction telling it to invent one, or a provider bug. Re-check the
      // same allowlist here so the executor, not the model's cooperation, is
      // what actually gates a consequential action (docs/02 §4).
      if (!allowed.has(call.name)) throw notFound(`tool ${call.name}`);
      result = await runOrbitTool(ctx, call.name, call.args);
    } catch (err) {
      if (err instanceof AppError && err.code === "approval_required") {
        outcome = "awaiting_approval";
        approvalId = (err.extras.approval_id as string | undefined) ?? null;
        result = { error: "approval_required", approvalId, policyKey: err.detail };
      } else {
        outcome = "error";
        result = { error: err instanceof Error ? err.message : "tool error" };
      }
    }
    await ctx.db.insert(schema.aiToolCalls).values({
      id: newId("atc", ctx.now),
      tenantId: ctx.tenantId,
      runId,
      seq: seq++,
      tool: call.name,
      argsHash: await hashObject(call.args),
      argsRedactedJson: JSON.stringify(call.args),
      consequential: def?.consequential ?? false,
      approvalId,
      outcome,
      resultHash: await hashObject(result),
      durationMs: Date.now() - startedAt,
      ts: ctx.now
    });
    messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(result) });
  }
  return messages;
}

/** Filters the registry down to what an agent is allowed to reach for. */
export function orbitToolsFor(agent: { toolsJson: string | null }): ToolDef[] {
  const allow = agent.toolsJson ? (JSON.parse(agent.toolsJson) as string[]) : null;
  return ORBIT_TOOL_DEFS.filter((t) => !allow || allow.includes(t.name));
}
