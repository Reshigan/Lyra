import { Hono } from "hono";
import { PolicyJson, EntitlementsJson, schema } from "@lyra/db";
import { notFound, pruneIdempotency } from "@lyra/core";
import { drainOutbox } from "./dispatch.js";
import { sweepRenewals } from "./engines/renewals.js";
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

// Hand-written routes mount BEFORE generated CRUD. Hono returns handlers in
// registration order, so whatever registers first wins a path both can serve —
// and where both can serve one, the hand-written engine is the one that must
// run. Generated CRUD would otherwise swallow `POST /v1/ai/runs` (the agent
// invocation), `POST /v1/analytics/reports` (which derives the required
// permission from the dataset instead of trusting the body) and
// `GET /v1/dist/commission-entries/statement` (read as an id).
app.route("/v1/dist", distRoutes);
app.route("/v1/ledger", ledgerRoutes);
app.route("/v1/ai", aiRoutes);
app.route("/v1/analytics", analyticsRoutes);

for (const [module, resources] of Object.entries(BY_MODULE)) {
  mountAll(app.basePath(`/v1/${module}`) as unknown as Hono<App>, resources);
}

// A route that does not exist is a 404, not a 500. This is the answer a client
// gets when it POSTs to a read-only resource, so it has to be the honest one.
app.notFound((c) => onError(notFound(c.req.path), c));

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
          await sweepRenewals(ctx);
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
