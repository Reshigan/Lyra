import type { ModelRequest, Provider, ProviderResult } from "../types.js";

// Deterministic provider for tests, CI and the demo seed. Never registered in
// production routing — a caller reaches it only by passing it explicitly.

/** Rough enough for budget arithmetic in tests; real counts come from the provider. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface StubScript {
  /** Reply for the next call, in order. Falls back to echoing the last user message. */
  replies?: string[];
  toolCalls?: ProviderResult["toolCalls"];
  finishReason?: ProviderResult["finishReason"];
  fail?: Error;
  /** Bytes returned by generateImage. Defaults to a 1-byte placeholder. */
  imageBytes?: Uint8Array;
}

export function makeStub(
  script: StubScript = {}
): Provider & { calls: ModelRequest[]; imageCalls: string[] } {
  const calls: ModelRequest[] = [];
  const imageCalls: string[] = [];
  let n = 0;
  return {
    name: "stub",
    calls,
    imageCalls,
    async complete(req) {
      calls.push(req);
      if (script.fail) throw script.fail;
      const last = [...req.messages].reverse().find((m) => m.role === "user");
      const text = script.replies?.[n++] ?? `echo: ${last?.content ?? ""}`;
      const tokensIn = req.messages.reduce((s, m) => s + approxTokens(m.content), 0);
      return {
        text,
        toolCalls: script.toolCalls ?? [],
        tokensIn,
        tokensOut: approxTokens(text),
        finishReason: script.finishReason ?? "stop"
      };
    },
    async embed(req) {
      if (script.fail) throw script.fail;
      // Hash-bucketed unit vectors: stable per text, no network, similar texts differ.
      const vectors = req.texts.map((t) => {
        const v = new Array<number>(8).fill(0);
        for (let i = 0; i < t.length; i++) v[i % 8]! += t.charCodeAt(i);
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
      const tokensIn = req.texts.reduce((s, t) => s + approxTokens(t), 0);
      return { vectors, usage: { tokensIn, tokensOut: 0, costMicro: 0 } };
    },
    async generateImage(prompt) {
      imageCalls.push(prompt);
      if (script.fail) throw script.fail;
      return { bytes: script.imageBytes ?? new Uint8Array([1]), contentType: "image/png" };
    }
  };
}
