import { Hono } from "hono";
import { z } from "zod";
import { badRequest, require_, withIdempotency, type Ctx } from "@lyra/core";
import { EXPORT_FORMATS, isExportFormat } from "../engines/export/render.js";
import {
  approveSettlement,
  disputeSettlement,
  getSettlement,
  paySettlement,
  reopenSettlement,
  runSettlement,
  settlementStatement,
  statementTable
} from "../engines/settlement.js";
import { body } from "../http.js";
import type { App } from "../env.js";

// docs/19 §5. The doorway to the settlement engine. Note what is absent: no
// route writes `state`, `net_minor` or a journal line. A settlement moves by
// running one of four verbs, each of which carries its own approval, so a
// payout can never be produced by a well-aimed PATCH.

export const settlementRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

const RunBody = z.object({
  counterpartyKind: z.string().min(1).max(40),
  counterpartyRef: z.string().min(1).max(200),
  period: z.string().min(7).max(7),
  currency: z.string().length(3).optional()
});

const ReasonBody = z.object({ reason: z.string().min(3).max(500) });

/** Draft (or redraft) a period. Arithmetic only — nothing posts here. */
settlementRoutes.post("/runs", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:settle", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(c, RunBody);
  const result = await withIdempotency(ctx, c.req.header("idempotency-key"), "settlement.run", input, () =>
    runSettlement(ctx, input)
  );
  return c.json(result, 201);
});

settlementRoutes.get("/settlements/:id", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await getSettlement(ctx, c.req.param("id")));
});

/** The lines behind the total, as JSON. The same shape the statement renders. */
settlementRoutes.get("/settlements/:id/lines", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:read", { tenantId: ctx.tenantId, module: "ledger" });
  const settlement = await getSettlement(ctx, c.req.param("id"));
  const { table, totals, terms } = await statementTable(ctx, settlement);
  return c.json({ settlement, table, totals, terms });
});

settlementRoutes.post("/settlements/:id/approve", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:settle", { tenantId: ctx.tenantId, module: "ledger" });
  const settlementId = c.req.param("id");
  const row = await withIdempotency(
    ctx,
    c.req.header("idempotency-key"),
    "settlement.approve",
    { settlementId },
    () => approveSettlement(ctx, settlementId)
  );
  return c.json(row);
});

/** Releases money. A second signature, a different policy, a different person. */
settlementRoutes.post("/settlements/:id/pay", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:payouts:approve", { tenantId: ctx.tenantId, module: "ledger" });
  const settlementId = c.req.param("id");
  const row = await withIdempotency(ctx, c.req.header("idempotency-key"), "settlement.pay", { settlementId }, () =>
    paySettlement(ctx, settlementId)
  );
  return c.json(row);
});

settlementRoutes.post("/settlements/:id/dispute", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:settle", { tenantId: ctx.tenantId, module: "ledger" });
  const { reason } = await body(c, ReasonBody);
  return c.json(await disputeSettlement(ctx, c.req.param("id"), reason));
});

settlementRoutes.post("/settlements/:id/reopen", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:settle", { tenantId: ctx.tenantId, module: "ledger" });
  const { reason } = await body(c, ReasonBody);
  return c.json(await reopenSettlement(ctx, c.req.param("id"), reason));
});

/** Remittance advice — PDF for the counterparty, XLSX for their finance team. */
settlementRoutes.get("/settlements/:id/statement", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dist:commissions:read", { tenantId: ctx.tenantId, module: "ledger" });
  const format = c.req.query("format") ?? "pdf";
  if (!isExportFormat(format)) throw badRequest(`format must be one of ${EXPORT_FORMATS.join(", ")}`);

  const result = await settlementStatement(ctx, c.req.param("id"), format, c.env.FILES);
  return new Response(result.rendered.bytes, {
    headers: {
      "content-type": result.rendered.contentType,
      "content-disposition": `attachment; filename="${result.filename}"`,
      "x-lyra-file-id": result.fileId,
      "cache-control": "no-store"
    }
  });
});
