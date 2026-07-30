import type { MiddlewareHandler } from "hono";
import { Gateway } from "@lyra/model-gateway";
import { authenticate, ctxFor } from "./auth.js";
import { problem } from "./http.js";
import type { App, Env } from "./env.js";

// Every request passes through the same four steps: clock, auth, ctx, gateway.
// Handlers below this file never see a raw binding, so there is no path that
// reaches the database without a tenant id attached.

/**
 * Routes reachable without credentials. Everything else authenticates.
 *
 * The `/v1/auth/mfa/*` routes are here because the caller holds a real session
 * that has deliberately not cleared the second-factor gate `authenticate`
 * applies — they resolve and check that session themselves (auth.ts §mfa).
 */
const PUBLIC = new Set([
  "/health",
  "/v1/auth/login",
  "/v1/auth/logout",
  "/v1/auth/mfa/enrol",
  "/v1/auth/mfa/enrol/confirm",
  "/v1/auth/mfa/verify",
  "/v1/auth/mfa/disable",
  // Demo persona sign-in. The routes themselves 404 outside a demo deployment
  // (auth.ts §demoOnly), so being listed here costs nothing in production.
  "/v1/auth/demo/personas",
  "/v1/auth/demo/login",
  "/openapi.json"
]);

export const withContext: MiddlewareHandler<App> = async (c, next) => {
  const now = Date.now();
  c.set("startedAt", now);

  // `/v1/auth/sso/*` is public by shape rather than by name: it carries a
  // provider id and there is no session until the callback creates one.
  if (PUBLIC.has(c.req.path) || c.req.path.startsWith("/v1/auth/sso/")) {
    c.set("requestId", crypto.randomUUID());
    return next();
  }

  const auth = await authenticate(c.env, c.req.raw, now);
  const ctx = await ctxFor(
    c.env,
    auth,
    now,
    c.req.header("cf-connecting-ip"),
    c.req.header("user-agent")
  );
  c.set("ctx", ctx);
  c.set("requestId", ctx.requestId);
  c.set("gateway", gatewayFor(c.env));
  return next();
};

export function gatewayFor(env: Env): Gateway {
  return new Gateway({
    env: {
      ...(env.AI ? { AI: env.AI } : {}),
      ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
      ...(env.AI_GATEWAY_URL ? { AI_GATEWAY_URL: env.AI_GATEWAY_URL } : {}),
      ...(env.OPENAI_COMPAT_URL ? { OPENAI_COMPAT_URL: env.OPENAI_COMPAT_URL } : {}),
      ...(env.OPENAI_COMPAT_API_KEY ? { OPENAI_COMPAT_API_KEY: env.OPENAI_COMPAT_API_KEY } : {})
    }
  });
}

/** Response headers that apply to every route, including error responses. */
export const withHeaders: MiddlewareHandler<App> = async (c, next) => {
  await next();
  c.header("x-request-id", c.get("requestId") ?? "");
  c.header("x-response-time-ms", String(Date.now() - (c.get("startedAt") ?? Date.now())));
  c.header("referrer-policy", "no-referrer");
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
};

/**
 * CORS for the first-party web app only. A wildcard origin plus credentials is
 * not a valid combination anyway, so there is nothing to loosen here later.
 */
export const withCors: MiddlewareHandler<App> = async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = c.env.APP_ORIGIN;
  if (origin && allowed && origin === allowed) {
    c.header("access-control-allow-origin", origin);
    c.header("access-control-allow-credentials", "true");
    c.header("vary", "origin");
  }
  if (c.req.method === "OPTIONS") {
    c.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    c.header("access-control-allow-headers", "content-type,authorization,idempotency-key,x-approval-id");
    c.header("access-control-max-age", "600");
    return c.body(null, 204);
  }
  return next();
};

export function onError(err: unknown, c: Parameters<typeof problem>[0]): Response {
  const res = problem(c, err);
  // The client only ever sees the generic 500 (toProblem never leaks internals),
  // so without this line an unexpected failure is invisible in Workers Logs too.
  // Anything that maps to a 4xx is a normal outcome and stays quiet.
  if (res.status >= 500) {
    console.error(`unhandled ${c.req.method} ${c.req.path}:`, err instanceof Error ? err.stack : err);
  }
  return res;
}
