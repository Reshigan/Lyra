import type { ProviderName, Tier } from "./types.js";

// The routing table. Changing a model is a one-line edit here, never in a
// caller — callers only ever ask for a tier.

export interface ModelDef {
  provider: ProviderName;
  model: string;
  /** micro-USD per 1,000 tokens. costMicro on ai_audit_log is micro-USD. */
  inPer1k: number;
  outPer1k: number;
  maxTokens: number;
  tools: boolean;
}

export const CATALOGUE: Record<string, ModelDef> = {
  "claude-opus-5": { provider: "anthropic", model: "claude-opus-5", inPer1k: 15_000, outPer1k: 75_000, maxTokens: 64_000, tools: true },
  "claude-sonnet-5": { provider: "anthropic", model: "claude-sonnet-5", inPer1k: 3_000, outPer1k: 15_000, maxTokens: 64_000, tools: true },
  "claude-haiku-4-5": { provider: "anthropic", model: "claude-haiku-4-5-20251001", inPer1k: 800, outPer1k: 4_000, maxTokens: 32_000, tools: true },
  "llama-3.3-70b": { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", inPer1k: 290, outPer1k: 2_250, maxTokens: 8_192, tools: true },
  "llama-3.1-8b": { provider: "workers-ai", model: "@cf/meta/llama-3.1-8b-instruct-fast", inPer1k: 28, outPer1k: 226, maxTokens: 8_192, tools: false },
  "bge-m3": { provider: "workers-ai", model: "@cf/baai/bge-m3", inPer1k: 12, outPer1k: 0, maxTokens: 8_192, tools: false },
  // On-prem: whatever vLLM serves. Cost is the tenant's own hardware, so zero.
  "internal-chat": { provider: "openai-compat", model: "internal-chat", inPer1k: 0, outPer1k: 0, maxTokens: 32_000, tools: true },
  "internal-embed": { provider: "openai-compat", model: "internal-embed", inPer1k: 0, outPer1k: 0, maxTokens: 8_192, tools: false }
};

/**
 * Cloud default: Workers AI on every tier. No third-party key to hold, no egress,
 * and the AI binding is already in the Worker. The Anthropic adapter stays wired
 * up and reachable through a tenant override for the tiers that later need it.
 */
export const CLOUD_ROUTES: Record<Tier, string> = {
  fast: "llama-3.1-8b",
  standard: "llama-3.3-70b",
  reasoning: "llama-3.3-70b"
};

/** On-prem tenants send nothing to a third party — every tier goes internal. */
export const ONPREM_ROUTES: Record<Tier, string> = {
  fast: "internal-chat",
  standard: "internal-chat",
  reasoning: "internal-chat"
};

export const EMBED_MODEL = { cloud: "bge-m3", onprem: "internal-embed" } as const;

export interface RouteOptions {
  /** PolicyJson.dataResidency === "on-prem" pins every tier internal. */
  onPrem?: boolean;
  /** Tenant override: tier -> catalogue key. Unknown keys are ignored, not obeyed. */
  overrides?: Partial<Record<Tier, string>>;
  /** The request carries tools, so a model without tool support cannot serve it. */
  needsTools?: boolean;
}

export function resolveModel(tier: Tier, opts: RouteOptions = {}): ModelDef & { key: string } {
  const base = opts.onPrem ? ONPREM_ROUTES : CLOUD_ROUTES;
  const override = opts.overrides?.[tier];
  let key = override && CATALOGUE[override] ? override : base[tier];
  let def = CATALOGUE[key];
  if (!def) throw new Error(`no model for tier ${tier}`);

  // ponytail: an on-prem tenant with a cloud override is a data-residency breach,
  // so the pin wins over the override rather than the other way round.
  if (opts.onPrem && def.provider !== "openai-compat") {
    key = ONPREM_ROUTES[tier];
    def = CATALOGUE[key]!;
  }

  // Silently dropping tools would look like the model ignoring an instruction.
  // Upgrade within the same provider instead, and let the cost land where it must.
  if (opts.needsTools && !def.tools) {
    const upgrade = Object.entries(CATALOGUE).find(([, d]) => d.provider === def!.provider && d.tools);
    if (!upgrade) throw new Error(`no tool-capable model for provider ${def.provider}`);
    return { key: upgrade[0], ...upgrade[1] };
  }

  return { key, ...def };
}

/** micro-USD, rounded up so a tenant is never under-billed against its budget. */
export function costMicro(def: ModelDef, tokensIn: number, tokensOut: number): number {
  return Math.ceil((tokensIn * def.inPer1k + tokensOut * def.outPer1k) / 1000);
}
