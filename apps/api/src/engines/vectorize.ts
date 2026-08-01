import type { Ctx } from "@lyra/core";
import type { Gateway } from "@lyra/model-gateway";
import type { VectorizeIndex } from "../env.js";

// docs/21 KB search, SCOUT whitespace bench, ORBIT conversation memory: three
// Vectorize indexes, same two operations. No-op when the index isn't bound —
// same idiom as engines/realtime.ts — so a deploy without Vectorize configured
// still runs, it just doesn't recall anything.

/** Embeds `text` and upserts it under `id`. Returns the vector id, or undefined if `index` isn't bound. */
export async function embedUpsert(
  ctx: Ctx,
  gateway: Gateway,
  index: VectorizeIndex | undefined,
  opts: { module: string; purpose: string; id: string; text: string; metadata?: Record<string, unknown> }
): Promise<string | undefined> {
  if (!index) return undefined;
  const { vectors } = await gateway.embed(ctx, { module: opts.module, purpose: opts.purpose, texts: [opts.text] });
  const values = vectors[0];
  if (!values) return undefined;
  await index.upsert([{ id: opts.id, values, ...(opts.metadata ? { metadata: opts.metadata } : {}) }]);
  return opts.id;
}

/** Embeds `text` and returns the topK nearest matches. Empty when `index` isn't bound. */
export async function embedQuery(
  ctx: Ctx,
  gateway: Gateway,
  index: VectorizeIndex | undefined,
  opts: { module: string; purpose: string; text: string; topK: number; filter?: Record<string, unknown> }
): Promise<{ id: string; score: number; metadata?: Record<string, unknown> }[]> {
  if (!index) return [];
  const { vectors } = await gateway.embed(ctx, { module: opts.module, purpose: opts.purpose, texts: [opts.text] });
  const values = vectors[0];
  if (!values) return [];
  const { matches } = await index.query(values, {
    topK: opts.topK,
    returnMetadata: true,
    ...(opts.filter ? { filter: opts.filter } : {})
  });
  return matches;
}
