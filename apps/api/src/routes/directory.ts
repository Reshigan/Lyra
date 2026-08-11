import { Hono } from "hono";
import { asc, ne } from "drizzle-orm";
import { mask, scoped, type Ctx } from "@lyra/core";
import { schema } from "@lyra/db";
import type { App } from "../env.js";

// "Who can I assign this to?" — one list, five screens. The AXIS board, the
// exceptions queue, the claims desk, the ORBIT thread and the SIGNAL studio
// each asked a person to type `user:us_01KE…VNK5` into a free-text box, which
// is not a thing any human knows. The refs here are already in the shape those
// fields take on the wire, so a picker submits what the action expects.
//
// Readable to any signed-in actor, for the same reason /v1/names resolves the
// staff directory (ADR-0046): handing your conversation to a colleague is not
// an administrative act. This one enumerates, which ADR-0046 deliberately did
// not — see ADR-0047 for what that costs and what it does not include.

export const directoryRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

/** A tenant's staff list, not a page of results: big enough for every real
 *  org chart, small enough that no caller can walk the table with it. */
const MAX_ENTRIES = 500;

interface Entry {
  /** `user:us_…` / `team:tm_…` — exactly what an assignment field submits. */
  ref: string;
  name: string;
}

directoryRoutes.get("/", async (c) => {
  const ctx = ctxOf(c);
  const kind = c.req.query("kind");
  const entries: Entry[] = [];

  if (kind !== "team") {
    const rows = (await ctx.db
      .select()
      .from(schema.users)
      // A suspended account is still a row; it is not somebody to hand a case
      // to. Invited staff stay listed — assigning their first case is often
      // why they were invited.
      .where(scoped(ctx, schema.users, ne(schema.users.status, "suspended")))
      .orderBy(asc(schema.users.name))
      .limit(MAX_ENTRIES)) as { id: string; name: string }[];
    for (const row of rows) {
      // Same masking every other read of `users.name` applies: without
      // core:pii:view a colleague reads `Layla A•• M•••••••`, which is still
      // enough to pick the right person off a list you already work with.
      const name = mask(ctx.actor, { name: row.name }, { name: "name" }, ctx.tenantId).name;
      entries.push({ ref: `user:${row.id}`, name });
    }
  }

  if (kind !== "user") {
    const rows = (await ctx.db
      .select()
      .from(schema.teams)
      .where(scoped(ctx, schema.teams))
      .orderBy(asc(schema.teams.name))
      .limit(MAX_ENTRIES)) as { id: string; name: string }[];
    for (const row of rows) entries.push({ ref: `team:${row.id}`, name: row.name });
  }

  return c.json({ entries });
});
