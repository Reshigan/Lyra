import type { Ctx } from "@lyra/core";
import type { Gateway } from "@lyra/model-gateway";

/**
 * Worker bindings. The on-prem twin supplies the same names from Docker env and
 * a libsql client instead of D1 — nothing below this file knows which home it is
 * running in (docs/02 §4).
 */
export interface Env {
  DB: D1Database;
  /** Workers AI. Default provider for every tier until a tenant overrides it. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  KV?: KVNamespace;
  FILES?: R2Bucket;
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  AI_GATEWAY_URL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_COMPAT_URL?: string;
  OPENAI_COMPAT_API_KEY?: string;
  SESSION_COOKIE?: string;
}

/** Per-request state carried on the Hono context. */
export interface Vars {
  ctx: Ctx;
  gateway: Gateway;
  requestId: string;
  startedAt: number;
}

export type App = { Bindings: Env; Variables: Vars };
