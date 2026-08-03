import type { Env } from "./env.js";

/**
 * Real time everywhere except a non-production deployment with a KV offset
 * staged by `/v1/auth/demo/clock` — the 30-day compressed simulation's virtual
 * clock (docs/24 sim plan). Production always gets the real clock even if
 * CONFIG somehow held a stale offset.
 */
export async function simNow(env: Env): Promise<number> {
  if ((env.ENVIRONMENT ?? "production") === "production" || !env.CONFIG) return Date.now();
  const raw = await env.CONFIG.get("sim:clock:offsetMs");
  return Date.now() + (raw ? Number(raw) : 0);
}
