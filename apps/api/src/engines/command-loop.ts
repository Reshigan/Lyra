import { id as newId, schema } from "@lyra/db";
import { type Ctx } from "@lyra/core";
import type { Gateway, Message, ToolCall } from "@lyra/model-gateway";
import { isOrbitTool, runOrbitTool } from "./orbit-tools.js";
import { toolsFor, type CommandToolDef } from "./command-tools.js";

// ADR-0073. The command loop: a bounded multi-round agent over the unified
// registry. The one rule that cannot bend (CLAUDE.md rule 4): a consequential
// tool never executes here. It becomes an ai_command_proposals row — args,
// policy key, and the run's reasoning as the inspectable "why" — and the model
// sees `proposed:<id>` back. A human actions it later through the module's real
// path, where the approval gate fires exactly once.

/** Hard ceiling on model rounds per run. A model that keeps asking for tools
 *  gets its last answer instead of an open tab on the tenant's budget. */
export const MAX_ROUNDS = 6;

/** docs/16 H2 / ADR-0049. The envelope decides which non-consequential tools
 *  auto-run; consequential tools propose under every level — no tenant setting
 *  may automate them (docs/19 §7's rule, applied to agents). */
export interface Envelope {
  level: "draft_only" | "assist" | "act_with_approval";
}

const ENVELOPE_LEVELS = ["draft_only", "assist", "act_with_approval"] as const;

export function envelopeFromPolicy(policyJson: string | null | undefined): Envelope {
  if (!policyJson) return { level: "draft_only" };
  try {
    const parsed = JSON.parse(policyJson) as { commandCenter?: { autonomy?: string } };
    const level = parsed.commandCenter?.autonomy;
    if (level && (ENVELOPE_LEVELS as readonly string[]).includes(level)) {
      return { level: level as Envelope["level"] };
    }
  } catch {
    // fall through to default
  }
  return { level: "draft_only" };
}

export interface LoopInput {
  agentKey: string;
  purpose: string;
  input: string;
  subjectRef?: string | undefined;
  locale?: "en" | "ar" | undefined;
}

export interface LoopRound {
  seq: number;
  toolCalls: { name: string; outcome: "ok" | "error" | "proposed"; proposalId?: string }[];
}

export interface LoopResult {
  runId: string;
  text: string;
  rounds: LoopRound[];
  proposalIds: string[];
  usage: { tokensIn: number; tokensOut: number; costMicro: number };
  finishReason: string;
  auditId: string;
}

/** The approval policy a consequential proposal gates under when actioned.
 *  Kept beside the registry so a new tool wires its gate in one place. */
const POLICY_FOR_TOOL: Record<string, string> = {
  create_endorsement_request: "axis.endorse"
};

interface ToolOutcome {
  outcome: "ok" | "error" | "proposed";
  result: unknown;
  proposalId?: string;
}

/** Consequential registry tools by name. */
const CONSEQUENTIAL = new Map<string, CommandToolDef>();

function primeConsequentialMap(defs: CommandToolDef[]): void {
  CONSEQUENTIAL.clear();
  for (const d of defs) if (d.consequential) CONSEQUENTIAL.set(d.name, d);
}

/**
 * Execute one tool call under the envelope. Reads run inline through their
 * handler (each checks its own permission); consequential calls become
 * proposals — never executed here, whatever the model asks for.
 */
async function executeCall(
  ctx: Ctx,
  runId: string,
  call: ToolCall,
  allow: ReadonlySet<string>,
  why: string
): Promise<ToolOutcome> {
  if (!allow.has(call.name)) {
    return { outcome: "error", result: `tool ${call.name} is not on this agent's allowlist` };
  }

  // Consequential → proposal. This branch is the whole point of the loop.
  if (CONSEQUENTIAL.has(call.name)) {
    const def = CONSEQUENTIAL.get(call.name)!;
    const proposalId = newId("cpr", ctx.now);
    await ctx.db.insert(schema.aiCommandProposals).values({
      id: proposalId,
      tenantId: ctx.tenantId,
      runId,
      module: def.module,
      toolName: call.name,
      subjectRef:
        typeof call.args.policyId === "string"
          ? call.args.policyId
          : typeof call.args.subjectRef === "string"
            ? call.args.subjectRef
            : null,
      policyKey: POLICY_FOR_TOOL[call.name] ?? null,
      argsJson: JSON.stringify(call.args),
      whyJson: JSON.stringify({ reason: why.slice(0, 2000) }),
      state: "proposed",
      createdAt: ctx.now
    });
    return {
      outcome: "proposed",
      proposalId,
      result: `proposed:${proposalId} — held for a human decision. Do not retry this call.`
    };
  }

  // Everything else today is either an ORBIT-handled read/write-through-gate
  // or a registry read. Both check permissions inside their handlers.
  try {
    let result: unknown;
    if (isOrbitTool(call.name)) {
      result = await runOrbitTool(ctx, call.name, call.args);
    } else {
      const { runCommandRead } = await import("./command-reads.js");
      result = await runCommandRead(ctx, call.name, call.args);
    }
    return { outcome: "ok", result };
  } catch (err) {
    return {
      outcome: "error",
      result: err instanceof Error ? err.message.slice(0, 300) : "tool error"
    };
  }
}

/**
 * Run the loop. Each round is its own gateway.complete call — separately
 * budgeted, scrubbed, guardrailed and audited by the gateway itself.
 */
export async function runCommandLoop(
  ctx: Ctx,
  gateway: Gateway,
  agent: { key: string; module: string; tier: string; toolsJson: string | null },
  input: LoopInput
): Promise<LoopResult> {
  const defs = toolsFor(agent);
  primeConsequentialMap(defs);
  const allow = new Set(defs.map((d) => d.name));
  const runId = newId("air", ctx.now);

  const messages: Message[] = [
    {
      role: "system",
      content:
        `You are the ${agent.key} agent at the tenant's command center. ` +
        "You may call tools to read across modules. Actions that change contracts, money or send anything outbound are never executed by you: they are proposed to a human, and you will see `proposed:<id>`. " +
        "When you have enough information, answer concisely and cite what you read."
    },
    { role: "user", content: input.input }
  ];

  const rounds: LoopRound[] = [];
  const proposalIds: string[] = [];
  let usage = { tokensIn: 0, tokensOut: 0, costMicro: 0 };

  const callOnce = async (): Promise<Awaited<ReturnType<Gateway["complete"]>>> => {
    const res = await gateway.complete(ctx, {
      module: "ai",
      purpose: input.purpose,
      tier: agent.tier as "fast" | "standard" | "reasoning",
      ...(input.subjectRef !== undefined ? { subjectRef: input.subjectRef } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      messages,
      ...(seq === 0 ? { tools: defs.map(({ module: _m, ...def }) => def) } : {})
    });
    usage = {
      tokensIn: usage.tokensIn + res.usage.tokensIn,
      tokensOut: usage.tokensOut + res.usage.tokensOut,
      costMicro: usage.costMicro + res.usage.costMicro
    };
    return res;
  };

  let seq = 0;
  let last = await callOnce();

  while (last.toolCalls.length > 0 && seq < MAX_ROUNDS - 1) {
    seq += 1;
    const round: LoopRound = { seq, toolCalls: [] };

    for (const call of last.toolCalls) {
      const outcome = await executeCall(ctx, runId, call, allow, last.text);
      if (outcome.proposalId) proposalIds.push(outcome.proposalId);
      round.toolCalls.push({
        name: call.name,
        outcome: outcome.outcome,
        ...(outcome.proposalId ? { proposalId: outcome.proposalId } : {})
      });
      messages.push({ role: "assistant", content: last.text });
      messages.push({
        role: "user",
        content: `tool ${call.name} → ${JSON.stringify(outcome.result).slice(0, 4000)}`
      });
    }
    rounds.push(round);

    last = await callOnce();
  }

  return {
    runId,
    text: last.text,
    rounds,
    proposalIds,
    usage,
    finishReason: last.finishReason,
    auditId: last.auditId
  };
}
