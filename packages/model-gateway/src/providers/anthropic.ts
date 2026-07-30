import type { Message, ModelRequest, Provider, ProviderEnv, ProviderResult, ToolCall } from "../types.js";

// Anthropic through the Cloudflare AI Gateway (docs/02 §9 — the gateway is
// mandatory so cost, caching and rate limiting are observable in one place).
// Not on the default route today; kept behind a tenant model override.

const VERSION = "2023-06-01";

interface AnthropicBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/** Anthropic takes system as a top-level field, not a message. */
function split(messages: readonly Message[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) =>
      m.role === "tool"
        ? {
            role: "user" as const,
            content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }]
          }
        : { role: m.role as "user" | "assistant", content: m.content }
    );
  return { system, rest };
}

const FINISH: Record<string, ProviderResult["finishReason"]> = {
  end_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "refusal",
  stop_sequence: "stop"
};

export const anthropic: Provider = {
  name: "anthropic",

  async complete(req: ModelRequest, model: string, env: ProviderEnv): Promise<ProviderResult> {
    if (!env.ANTHROPIC_API_KEY) throw new Error("anthropic: ANTHROPIC_API_KEY missing");
    const base = env.AI_GATEWAY_URL ?? "https://api.anthropic.com";
    const { system, rest } = split(req.messages);

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      messages: rest
    };
    if (system) body["system"] = system;
    if (req.tools?.length) {
      body["tools"] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    const doFetch = env.fetch ?? fetch;
    const res = await doFetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": VERSION
      },
      body: JSON.stringify(body)
    });

    const json = (await res.json()) as AnthropicResponse;
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${json.error?.message ?? "request failed"}`);

    const blocks = json.content ?? [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id ?? "", name: b.name ?? "", args: b.input ?? {} }));

    return {
      text,
      toolCalls,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
      finishReason: FINISH[json.stop_reason ?? "end_turn"] ?? "stop"
    };
  }
};
