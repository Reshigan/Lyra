import { Hono } from "hono";
import { getTableColumns, like, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { badRequest, can, require_, scoped, type Ctx } from "@lyra/core";
import { REGISTRY } from "../crud.js";
import type { App } from "../env.js";

// docs/24 Phase 2 item 10: no new table. Fans out over every already-registered
// Resource's own `searchable` columns, one scoped query per resource type. Base
// gate reuses the pre-existing, previously-unused core:search:read permission
// (rbac.ts) rather than inventing a new one (CLAUDE.md rule 15, build to the
// seams). Each hit is additionally filtered by the searcher's own read
// permission on that specific resource — otherwise this route would be a
// permission-bypass side channel onto data the caller can't otherwise read.

export const searchRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

searchRoutes.get("/", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "core:search:read", { tenantId: ctx.tenantId, module: "core" });
  const q = c.req.query("q");
  if (!q || !q.trim()) throw badRequest("q is required");
  const term = `%${q.replace(/[%_]/g, "")}%`;

  // Permission + column checks are synchronous and run first, so a query is
  // never even issued for a resource the caller can't read (see file header:
  // this is what keeps the route from being a permission-bypass side
  // channel). Only the queries themselves - the round trips - run in
  // parallel.
  const queries = REGISTRY.flatMap((r) => {
    if (!r.searchable?.length) return [];
    if (!can(ctx.actor, r.perms.read, { tenantId: ctx.tenantId, module: r.module })) return [];

    const cols = getTableColumns(r.table) as Record<string, SQLiteColumn>;
    const clauses = r.searchable.map((k) => cols[k]).filter((col): col is SQLiteColumn => Boolean(col)).map((col) => like(col, term));
    if (!clauses.length) return [];

    return [{ resource: r.path, module: r.module, secret: new Set(r.secretColumns ?? []), clauses, table: r.table }];
  });

  const perResource = await Promise.all(
    queries.map(async (entry) => {
      const rows = await ctx.db
        .select()
        .from(entry.table as never)
        .where(scoped(ctx, entry.table as never, or(...entry.clauses) as SQL))
        .limit(10);

      return rows.map((row) => {
        const out = { ...(row as Record<string, unknown>) };
        for (const key of entry.secret) delete out[key];
        return { resource: entry.resource, module: entry.module, row: out };
      });
    })
  );

  return c.json({ results: perResource.flat() });
});
