import { Hono } from "hono";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { pruneIdempotency } from "@lyra/core";
import { drainOutbox } from "./dispatch.js";
import { authRoutes, ctxFor, db, pruneSessions } from "./auth.js";
import { mountAll } from "./crud.js";
import { BY_MODULE } from "./resources.js";
import { onError, withContext, withCors, withHeaders } from "./mw.js";
import { openapi } from "./openapi.js";
import { meRoutes } from "./routes/me.js";
import { distRoutes } from "./routes/dist.js";
import { ledgerRoutes } from "./routes/ledger.js";
import { aiRoutes } from "./routes/ai.js";
import { analyticsRoutes } from "./routes/analytics.js";
import type { App, Env } from "./env.js";

// docs/04. One worker, one router. `/v1/<module>/<resource>` is generated CRUD;
// anything with real behaviour behind it is a hand-written route in routes/*.

const app = new Hono<App>();

app.onError(onError);
app.use("*", withHeaders);
app.use("*", withCors);
app.use("*", withContext);

app.get("/health", (c) =>
  c.json({ ok: true, environment: c.env.ENVIRONMENT ?? "production", ts: Date.now() })
);
app.get("/openapi.json", (c) => c.json(openapi()));

app.route("/v1/auth", authRoutes);
app.route("/v1/me", meRoutes);

for (const [module, resources] of Object.entries(BY_MODULE)) {
  mountAll(app.basePath(`/v1/${module}`) as unknown as Hono<App>, resources);
}

// Hand-written routes mount after CRUD so a specific path wins over `/:id`.
app.route("/v1/dist", distRoutes);
app.route("/v1/ledger", ledgerRoutes);
app.route("/v1/ai", aiRoutes);
app.route("/v1/analytics", analyticsRoutes);

app.notFound((c) => onError(new Error("not found"), c));

export default {
  fetch: app.fetch,

  /**
   * Outbox drain and session sweep. Both are idempotent, so a missed tick costs
   * latency and nothing else.
   */
  async scheduled(_event: unknown, env: Env, ctxExec: { waitUntil(p: Promise<unknown>): void }) {
    const now = Date.now();
    ctxExec.waitUntil(
      (async () => {
        await pruneSessions(env, now);
        await pruneIdempotency(db(env) as never, now);
        for (const tenantId of await activeTenants(env)) {
          const ctx = await ctxFor(
            env,
            {
              tenantId,
              locale: "en",
              actor: { kind: "system", id: "scheduler", tenantId, grants: [] },
              policy: PolicyJson.parse({}),
              entitlements: EntitlementsJson.parse({})
            },
            now
          );
          await drainOutbox(ctx);
        }
      })()
    );
  }
};

async function activeTenants(env: Env): Promise<string[]> {
  const rows = await db(env).select({ id: schema.tenants.id }).from(schema.tenants);
  return rows.map((t) => t.id);
}

export { app };
