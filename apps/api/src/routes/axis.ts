import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { actorRef, audit, conflict, require_, scoped, type Ctx } from "@lyra/core";
import { must } from "../rows.js";
import type { App } from "../env.js";

// docs/07 §3. The one axis verb generated CRUD cannot express: verifying a
// document. `verifiedBy` and `verifiedAt` are evidence that a named person
// looked at the file at a known time, so they come from the session and the
// clock — a PATCH would let the caller name its own verifier.

export const axisRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

axisRoutes.post("/documents/:id/verify", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:documents:verify", { tenantId: ctx.tenantId, module: "axis" });
  const rowId = c.req.param("id");
  // 404, not 403, for another tenant's document: `must` goes through the same
  // tenant scope every read does, so a row the caller may not see does not exist.
  const before = await must(ctx, schema.axisDocuments, rowId, "documents");
  if (before.status === "verified") throw conflict(`document is already ${before.status}`);

  // ponytail: no body at all. Nothing here is the caller's to choose, so there
  // is no schema to validate — the only input is the id in the path.
  const stamp = { verifiedBy: actorRef(ctx), verifiedAt: ctx.now, status: "verified" as const };
  await ctx.db
    .update(schema.axisDocuments)
    .set(stamp)
    .where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.id, rowId)));

  const after = { ...before, ...stamp };
  // Bare id, as the generated create/update/delete on this same row use — the
  // verification has to line up with them in one subject's audit trail.
  await audit(ctx, { action: "axis.documents.verify", subjectRef: rowId, before, after });
  return c.json(after);
});
