import { id, schema } from "@lyra/db";
import { actorRef, hashObject, sha256Hex, type Ctx } from "@lyra/core";
import { assertBudget, charge } from "./budget.js";
import { assertNotKilled } from "./kill.js";
import { blocked, checkInput, checkOutput, recordGuardrails, type GuardrailHit } from "./guardrails.js";
import { CATALOGUE, EMBED_MODEL, costMicro, resolveModel } from "./models.js";
import { resolvePurpose } from "./purposes.js";
import { rehydrate, scrubMessages } from "./scrub.js";
import { anthropic } from "./providers/anthropic.js";
import { openaiCompat } from "./providers/openai-compat.js";
import { workersAi } from "./providers/workers-ai.js";
import type {
  EmbedRequest,
  EmbedResponse,
  ModelRequest,
  ModelResponse,
  Provider,
  ProviderEnv,
  ProviderName
} from "./types.js";

// docs/02 §5. The only way to reach a model. Every call is budgeted, scrubbed,
// guarded and audited — calling a provider adapter directly bypasses all four,
// which is why they are not exported from the package root.

const REGISTRY: Partial<Record<ProviderName, Provider>> = {
  "workers-ai": workersAi,
  anthropic,
  "openai-compat": openaiCompat
};

export interface GatewayOptions {
  env: ProviderEnv;
  /** Tests and the seed pass a stub here; production never does. */
  providers?: Partial<Record<ProviderName, Provider>>;
  /**
   * Tier -> catalogue key. Tests only: production routing comes off
   * `ctx.policy.modelOverrides`, because a constructor option is one nobody
   * remembers to pass (docs/27 F8).
   */
  overrides?: Record<string, string>;
}

/** Retryable transport failures; a 4xx from a provider is not one. */
const RETRY_DELAYS_MS = [0, 250, 1000];

export class Gateway {
  constructor(private readonly opts: GatewayOptions) {}

  private pick(name: ProviderName): Provider {
    const p = this.opts.providers?.[name] ?? REGISTRY[name];
    if (!p) throw new Error(`no provider adapter for ${name}`);
    return p;
  }

  async complete(ctx: Ctx, req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();

    const onPrem = ctx.policy.dataResidency === "on-prem";
    const def = resolveModel(req.tier, {
      onPrem,
      overrides: (this.opts.overrides ?? ctx.policy.modelOverrides) as never,
      needsTools: Boolean(req.tools?.length),
      ...(req.modelKey !== undefined ? { modelKey: req.modelKey } : {})
    });

    // Scrub before anything sees the messages, including our own audit hash.
    const scrubbed = req.unscrubbed
      ? { messages: req.messages, map: new Map<string, string>(), flags: [] as string[] }
      : scrubMessages(req.messages);
    const flags = new Set(scrubbed.flags);

    // docs/27 F37. A tool result is third-party text — a fetched page, a
    // retrieved document, a partner API response — and reaches the model with
    // the same authority as the user turn, so it is screened with it. Assistant
    // turns are our own prior output and are not re-screened.
    const preHits: GuardrailHit[] = scrubbed.messages.flatMap((m) =>
      m.role === "user" || m.role === "tool" ? checkInput(m.content) : []
    );
    for (const h of preHits) flags.add(h.rule);

    // docs/27 F40. `purpose` arrives from the request body; `module` comes from
    // the trusted agent row. An unknown pair is treated as the strictest case.
    const purpose = resolvePurpose(req.module, req.purpose);
    for (const f of purpose.flags) flags.add(f);

    const inputHash = await hashObject({ model: def.model, messages: scrubbed.messages, tools: req.tools ?? [] });
    const auditId = id("aia", ctx.now);

    // Kill switch and budget are checked after the hash/audit id exist so a
    // blocked call still lands in ai_audit_log (CLAUDE.md §3: every call is
    // audited, not just the ones that reach a provider). The switch goes first:
    // a paused tenant should not burn budget rows to be told AI is off.
    for (const [outcome, check] of [
      ["killed", () => assertNotKilled(ctx, req.module)],
      ["budget_exceeded", () => assertBudget(ctx, req.module)]
    ] as const) {
      try {
        await check();
      } catch (err) {
        await this.writeAudit(ctx, {
          auditId,
          req,
          def,
          inputHash,
          outputHash: null,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          latencyMs: Date.now() - started,
          toolCalls: [],
          flags: [...flags, outcome],
          outcome
        });
        throw err;
      }
    }

    const outbound = { ...req, messages: scrubbed.messages };

    let result;
    let lastError: unknown;
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      try {
        result = await this.pick(def.provider).complete(outbound, def.model, this.opts.env);
        break;
      } catch (err) {
        lastError = err;
        if (!retryable(err)) break;
      }
    }

    if (!result) {
      await this.writeAudit(ctx, {
        auditId,
        req,
        def,
        inputHash,
        outputHash: null,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        latencyMs: Date.now() - started,
        toolCalls: [],
        flags: [...flags, "provider_error"],
        outcome: "error"
      });
      throw lastError instanceof Error ? lastError : new Error("model call failed");
    }

    const cost = costMicro(def, result.tokensIn, result.tokensOut);
    const postHits = checkOutput({
      text: result.text,
      issued: new Set(scrubbed.map.keys()),
      customerFacing: purpose.customerFacing,
      ...(req.intent !== undefined ? { intent: req.intent } : {})
    });
    for (const h of postHits) flags.add(h.rule);
    const refused = blocked(postHits);

    // Rehydrate only what we redacted, and only when the answer is not blocked.
    const text = refused ? "" : rehydrate(result.text, scrubbed.map);
    const outputHash = await sha256Hex(result.text);

    await this.writeAudit(ctx, {
      auditId,
      req,
      def,
      inputHash,
      outputHash,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      cost,
      latencyMs: Date.now() - started,
      toolCalls: result.toolCalls,
      flags: [...flags],
      outcome: refused ? "refused" : "ok"
    });
    await recordGuardrails(ctx, [...preHits, ...postHits], req.subjectRef ? { subjectRef: req.subjectRef } : {});
    // Tokens were burned whether or not we let the answer through.
    await charge(ctx, { tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicro: cost }, req.module);

    return {
      text,
      toolCalls: refused ? [] : result.toolCalls,
      model: def.model,
      provider: def.provider,
      tier: req.tier,
      usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicro: cost },
      latencyMs: Date.now() - started,
      finishReason: refused ? "refusal" : result.finishReason,
      flags: [...flags],
      auditId
    };
  }

  /** bge-m3 covers ar+en in one space (docs/02 §5), so no per-locale index. */
  async embed(ctx: Ctx, req: EmbedRequest): Promise<EmbedResponse> {
    // A paused tenant is paused for indexing too, or a kill switch quietly
    // leaves half the AI running.
    await assertNotKilled(ctx, req.module);
    await assertBudget(ctx, req.module);
    const onPrem = ctx.policy.dataResidency === "on-prem";
    const key = onPrem ? EMBED_MODEL.onprem : EMBED_MODEL.cloud;
    const def = CATALOGUE[key];
    if (!def) throw new Error(`no embedding model ${key}`);

    const provider = this.pick(def.provider);
    if (!provider.embed) throw new Error(`${def.provider} cannot embed`);

    // Embeddings are indexed and long-lived; scrubbing keeps PII out of the vector store.
    const scrubbed = scrubMessages(req.texts.map((content) => ({ content })));
    const out = await provider.embed(
      { ...req, texts: scrubbed.messages.map((m) => m.content) },
      def.model,
      this.opts.env
    );
    const cost = costMicro(def, out.usage.tokensIn, 0);
    await charge(ctx, { tokensIn: out.usage.tokensIn, tokensOut: 0, costMicro: cost }, req.module);

    return {
      vectors: out.vectors,
      model: def.model,
      provider: def.provider,
      usage: { ...out.usage, costMicro: cost }
    };
  }

  private async writeAudit(
    ctx: Ctx,
    a: {
      auditId: string;
      req: ModelRequest;
      def: { model: string; provider: ProviderName };
      inputHash: string;
      outputHash: string | null;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      latencyMs: number;
      toolCalls: unknown[];
      flags: string[];
      outcome: "ok" | "refused" | "error" | "budget_exceeded" | "killed";
    }
  ): Promise<void> {
    // Hashes, never content: ai_audit_log is queried by Compliance and must not
    // become a second copy of every customer conversation (docs/12 §4).
    await ctx.db.insert(schema.aiAuditLog).values({
      id: a.auditId,
      tenantId: ctx.tenantId,
      module: a.req.module,
      purpose: a.req.purpose,
      model: a.def.model,
      provider: a.def.provider,
      tier: a.req.tier,
      inputHash: a.inputHash,
      outputHash: a.outputHash,
      tokensIn: a.tokensIn,
      tokensOut: a.tokensOut,
      costMicro: a.cost,
      latencyMs: a.latencyMs,
      toolCallsJson: a.toolCalls.length ? JSON.stringify(a.toolCalls) : null,
      guardrailFlagsJson: a.flags.length ? JSON.stringify(a.flags) : null,
      actorRef: actorRef(ctx),
      subjectRef: a.req.subjectRef ?? null,
      outcome: a.outcome,
      ts: ctx.now
    });

    this.opts.env.TELEMETRY?.writeDataPoint({
      blobs: [ctx.tenantId, a.req.module, a.req.purpose, a.def.model, a.def.provider, a.outcome],
      doubles: [a.tokensIn, a.tokensOut, a.cost, a.latencyMs],
      indexes: [ctx.tenantId]
    });
  }
}

function retryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|5\d\d)\b|network|timeout|fetch failed/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
