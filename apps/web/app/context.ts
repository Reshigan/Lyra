import { createContext } from "react-router";
import type { Env } from "./env";

export interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Where loaders and actions reach workerd's `env`. React Router 8 replaced the
 * single augmentable `AppLoadContext` with typed contexts, so the binding is
 * declared once here and read with `context.get(cloudflare)`.
 */
export const cloudflare = createContext<{ env: Env; ctx: ExecutionCtx }>();
