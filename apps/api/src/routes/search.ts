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

  const results: { resource: string; module: string; row: Record<string, unknown> }[] = [];
  for (const r of REGISTRY) {
    if (!r.searchable?.length) continue;
    if (!can(ctx.actor, r.perms.read, { tenantId: ctx.tenantId, module: r.module })) continue;

    const cols = getTableColumns(r.table) as Record<string, SQLiteColumn>;
    const clauses = r.searchable.map((k) => cols[k]).filter((col): col is SQLiteColumn => Boolean(col)).map((col) => like(col, term));
    if (!clauses.length) continue;

    const rows = await ctx.db
      .select()
      .from(r.table as never)
      .where(scoped(ctx, r.table as never, or(...clauses) as SQL))
      .limit(10);

    const secret = new Set(r.secretColumns ?? []);
    for (const row of rows) {
      const out = { ...(row as Record<string, unknown>) };
      for (const key of secret) delete out[key];
      results.push({ resource: r.path, module: r.module, row: out });
    }
  }

  return c.json({ results });
});
