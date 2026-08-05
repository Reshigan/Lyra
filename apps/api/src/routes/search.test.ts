import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { notFound, type Ctx } from "@lyra/core";
import { REGISTRY } from "../crud.js";
import { onError } from "../mw.js";
// Side-effect only: REGISTRY is populated by resources.ts's own register()
// calls at import time (same as index.ts does for the real app). Without
// this, REGISTRY is empty here and search.ts has nothing to fan out over.
import "../resources.js";
import { searchRoutes } from "./search.js";
import type { App } from "../env.js";

// GET /v1/search used to fan out to every registered resource's own query
// one at a time (a `for...of` loop with `await` inside). Item 8: that's N
// sequential round trips for one request. The fix batches them with
// Promise.all; these tests pin down the two things that matter: the queries
// genuinely overlap now, and the permission-gate-before-query-fire property
// (file header comment in search.ts) still holds - a caller never gets a hit
// off a resource it can't read, and secret columns never leak.

function router(ctx: Ctx): Hono<App> {
  const app = new Hono<App>();
  app.onError(onError);
  app.notFound((c) => onError(notFound(c.req.path), c));
  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
  app.route("/", searchRoutes);
  return app;
}

function baseCtx(db: Ctx["db"], grants: string[]): Ctx {
  return {
    db,
    tenantId: "t_test",
    actor: { kind: "user", id: "u_test", tenantId: "t_test", grants: [{ roleKey: "test", permissions: grants }] },
    requestId: "req_test",
    now: Date.now(),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}

// search.ts's only use of ctx.db is exactly this chain - select().from().where().limit().
// Faking that (instead of standing up a real libsql instance) keeps the
// concurrency test deterministic and fast: real query latency is microseconds,
// far too small a window to prove overlap against on a shared CI box.
function fakeDb(onQuery: () => Promise<unknown[]>): Ctx["db"] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => onQuery()
        })
      })
    })
  } as unknown as Ctx["db"];
}

describe("GET /v1/search", () => {
  it("issues its per-resource queries in parallel, not one at a time (regression: IMPORTANT 8)", async () => {
    let pending = 0;
    let maxPending = 0;
    const db = fakeDb(async () => {
      pending++;
      maxPending = Math.max(maxPending, pending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      pending--;
      return [];
    });

    const searchableCount = REGISTRY.filter((r) => r.searchable?.length).length;
    expect(searchableCount).toBeGreaterThan(1);

    const ctx = baseCtx(db, ["*:*:*"]);
    const res = await router(ctx).fetch(new Request("http://api.test/?q=anything"));
    expect(res.status).toBe(200);

    // If the queries still ran sequentially, at most one would ever be
    // in flight at once.
    expect(maxPending).toBeGreaterThan(1);
  });

  it("never queries, and never returns, a resource the caller can't read - and still strips secret columns", async () => {
    const db = fakeDb(async () => [
      { id: "us_1", name: "Jamie", email: "jamie@example.com", passwordHash: "SECRET-HASH", mfaSecret: "SECRET-MFA" }
    ]);

    const ctx = baseCtx(db, ["core:search:read", "core:users:read"]);
    const res = await router(ctx).fetch(new Request("http://api.test/?q=jamie"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { results: { resource: string; row: Record<string, unknown> }[] };
    expect(body.results.every((hit) => hit.resource === "users")).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain("SECRET-HASH");
    expect(text).not.toContain("SECRET-MFA");
    expect(text).not.toContain("passwordHash");
  });

  it("400s a blank query and requires core:search:read at all", async () => {
    const db = fakeDb(async () => []);
    const withPerm = router(baseCtx(db, ["core:search:read"]));
    expect((await withPerm.fetch(new Request("http://api.test/?q=%20"))).status).toBe(400);

    const withoutPerm = router(baseCtx(db, []));
    expect((await withoutPerm.fetch(new Request("http://api.test/?q=jamie"))).status).toBe(403);
  });
});
