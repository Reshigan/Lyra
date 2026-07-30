import { Hono } from "hono";
import { z } from "zod";
import { require_, withIdempotency, type Ctx } from "@lyra/core";
import {
  RECIPES,
  TXN_STATES,
  TXN_TYPES,
  accountStatement,
  agedBalances,
  balanceOf,
  balanceSheet,
  buildRecipe,
  chartOfAccountsTable,
  clientMoneyPosition,
  closeChecks,
  closePeriod,
  commissionByDimension,
  decideMatch,
  ensurePeriod,
  getTxn,
  periodCode,
  profitAndLoss,
  rebuildBalances,
  reconSummary,
  reconcile,
  reopenPeriod,
  reverseTxn,
  runTxn,
  transition,
  trialBalance,
  trialBalanceTable,
  txnType,
  type MatchProposer,
  type TxnState
} from "@lyra/ledger";
import type { Gateway } from "@lyra/model-gateway";
import { body } from "../http.js";
import type { App } from "../env.js";

// docs/19. The ledger package holds the invariants; this file is the doorway.
// Note what is absent: no endpoint writes a journal line directly. Money moves
// by running a transaction type, which picks its recipe from the table — so a
// new transaction is a row in RECIPES, never a new posting path.

export const ledgerRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

/* ------------------------------------------------------------ transactions */

const RunBody = z.object({
  idempotencyKey: z.string().min(1).max(200),
  currency: z.string().length(3).optional(),
  baseCurrency: z.string().length(3).optional(),
  fxRatePpm: z.number().int().positive().optional(),
  grossMinor: z.number().int().optional(),
  correlationId: z.string().optional(),
  parentTxnId: z.string().optional(),
  subjectRefs: z.record(z.string(), z.string()).optional(),
  amounts: z.record(z.string(), z.number().int()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  periodCode: z.string().optional(),
  reason: z.string().max(500).optional(),
  /** Recipe arguments — validated by the recipe's own schema, not here. */
  args: z.record(z.string(), z.unknown()).default({})
});

/** The one write path for money. `type` is a key in TXN_TYPES. */
ledgerRoutes.post("/txn/:type", async (c) => {
  const ctx = ctxOf(c);
  const type = c.req.param("type").toUpperCase();
  const def = txnType(type); // throws 400 for an unknown code
  require_(ctx.actor, "ledger:txns:create", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(c, RunBody);

  const currency = input.currency ?? ctx.policy.currency;
  const recipe = RECIPES[type]
    ? {
        lines: buildRecipe(type, { ...input.args, currency }),
        currency,
        ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}),
        ...(input.fxRatePpm !== undefined ? { fxRatePpm: input.fxRatePpm } : {}),
        ...(input.periodCode !== undefined ? { periodCode: input.periodCode } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {})
      }
    : null; // non-financial types settle without a batch

  const txn = await withIdempotency(ctx, c.req.header("idempotency-key"), `ledger.txn.${type}`, input, () =>
    runTxn(
      ctx,
      {
        type,
        idempotencyKey: input.idempotencyKey,
        currency,
        actorKind: ctx.actor.kind,
        ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}),
        ...(input.grossMinor !== undefined ? { grossMinor: input.grossMinor } : {}),
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
        ...(input.parentTxnId !== undefined ? { parentTxnId: input.parentTxnId } : {}),
        ...(input.subjectRefs !== undefined ? { subjectRefs: input.subjectRefs } : {}),
        ...(input.amounts !== undefined ? { amounts: input.amounts } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
      },
      {
        recipe,
        event: { name: `ledger.txn.${type.toLowerCase()}.settled` }
      }
    )
  );

  return c.json({ txn, type: def }, 201);
});

ledgerRoutes.get("/txn/:id", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:txns:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await getTxn(ctx, c.req.param("id")));
});

/** The transaction-type catalogue, for the UI's type picker and the docs. */
ledgerRoutes.get("/txn-types", (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:txns:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json({
    data: Object.entries(TXN_TYPES).map(([code, def]) => ({
      ...def,
      code,
      financial: Boolean(RECIPES[code])
    }))
  });
});

/** Manual state moves for the operator: only the legal hops, always audited. */
ledgerRoutes.post("/txn/:id/transition", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:txns:authorize", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(
    c,
    z.object({
      to: z.enum(TXN_STATES),
      reason: z.string().max(500).optional(),
      failureCode: z.string().max(64).optional(),
      failureDetail: z.string().max(500).optional()
    })
  );
  const { to, ...opts } = input;
  return c.json(await transition(ctx, c.req.param("id"), to as TxnState, opts));
});

ledgerRoutes.post("/txn/:id/reverse", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:txns:reverse", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(
    c,
    z.object({ reason: z.string().min(3).max(500), idempotencyKey: z.string().optional() })
  );
  const { reason, idempotencyKey } = input;
  return c.json(
    await reverseTxn(ctx, c.req.param("id"), reason, idempotencyKey ? { idempotencyKey } : {})
  );
});

/* ----------------------------------------------------------------- periods */

ledgerRoutes.get("/periods/:code", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:periods:read", { tenantId: ctx.tenantId, module: "ledger" });
  const code = c.req.param("code");
  return c.json({ period: await ensurePeriod(ctx, code), checks: await closeChecks(ctx, code) });
});

ledgerRoutes.post("/periods/:code/close", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:periods:close", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(
    c,
    z.object({ to: z.enum(["soft_closed", "hard_closed"]), force: z.boolean().default(false) })
  );
  return c.json(await closePeriod(ctx, c.req.param("code"), input.to, { force: input.force }));
});

ledgerRoutes.post("/periods/:code/reopen", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:periods:close", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await reopenPeriod(ctx, c.req.param("code")));
});

/* ----------------------------------------------------------------- reports */

const asOf = (c: { req: { query(k: string): string | undefined } }): number | undefined => {
  const raw = c.req.query("asOf");
  return raw ? Number(raw) : undefined;
};

ledgerRoutes.get("/reports/trial-balance", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  const at = asOf(c);
  const tb = await trialBalance(ctx, {
    ...(c.req.query("period") ? { periodCode: c.req.query("period") as string } : {}),
    ...(c.req.query("currency") ? { currency: c.req.query("currency") as string } : {}),
    ...(at !== undefined ? { asOf: at } : {})
  });
  // `?format=table` returns the export shape the reporting engine feeds to XLSX
  // and PDF, so a spreadsheet and the screen cannot drift apart.
  return c.json(c.req.query("format") === "table" ? trialBalanceTable(tb) : tb);
});

ledgerRoutes.get("/reports/pnl", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await profitAndLoss(ctx, c.req.query("period") ?? periodCode(ctx.now)));
});

ledgerRoutes.get("/reports/balance-sheet", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await balanceSheet(ctx, asOf(c)));
});

ledgerRoutes.get("/reports/aged", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  const codes = c.req.query("accounts")?.split(",").filter(Boolean);
  const at = asOf(c);
  return c.json({
    data: await agedBalances(ctx, {
      ...(codes?.length ? { accountCodes: codes } : {}),
      ...(at !== undefined ? { asOf: at } : {})
    })
  });
});

ledgerRoutes.get("/reports/commission", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  const dimension = c.req.query("by") ?? "provider";
  return c.json({
    dimension,
    data: await commissionByDimension(ctx, dimension, {
      ...(c.req.query("period") ? { periodCode: c.req.query("period") as string } : {})
    })
  });
});

ledgerRoutes.get("/reports/client-money", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:client_money:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json({ data: await clientMoneyPosition(ctx, c.req.query("currency")) });
});

ledgerRoutes.get("/reports/chart-of-accounts", (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(chartOfAccountsTable());
});

ledgerRoutes.get("/accounts/:code/statement", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  const from = c.req.query("from") ? Number(c.req.query("from")) : undefined;
  const to = c.req.query("to") ? Number(c.req.query("to")) : undefined;
  return c.json(
    await accountStatement(ctx, c.req.param("code"), {
      ...(c.req.query("currency") ? { currency: c.req.query("currency") as string } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      limit: 1000
    })
  );
});

ledgerRoutes.get("/accounts/:code/balance", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await balanceOf(ctx, c.req.param("code"), c.req.query("currency") ?? ctx.policy.currency));
});

/**
 * Rebuild the balance cache from the journal. The journal is the truth and the
 * cache is derived, so this is always safe to run — it is the answer to "the
 * dashboard looks wrong", not a data fix.
 */
ledgerRoutes.post("/balances/rebuild", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:journals:post", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await rebuildBalances(ctx));
});

/* ------------------------------------------------------------ reconciliation */

const StatementLine = z.object({
  ref: z.string().min(1),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  ourRef: z.string().optional(),
  postedAt: z.number().int().optional(),
  description: z.string().max(500).optional()
});

ledgerRoutes.post("/recon/runs", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:recon:run", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(
    c,
    z.object({
      process: z.enum(["insurer", "psp", "client_money", "partner", "media"]),
      period: z.string().min(1),
      currency: z.string().length(3),
      counterpartyRef: z.string().optional(),
      statementFileId: z.string().optional(),
      toleranceMinor: z.number().int().min(0).optional(),
      /** Opt in to pass 3. Off by default: no silent AI in the money path. */
      propose: z.boolean().default(false),
      lines: z.array(StatementLine).min(1).max(5000)
    })
  );

  const { propose, ...rest } = input;
  return c.json(
    await reconcile(ctx, {
      ...rest,
      ...(propose ? { propose: aiProposer(ctx, c.get("gateway")) } : {})
    }),
    201
  );
});

/**
 * Pass 3. The model only ever *proposes* — every ai_proposed match lands in
 * `proposed` and needs a human `decide`, so a hallucinated join can never post.
 */
function aiProposer(ctx: Ctx, gateway: Gateway): MatchProposer {
  return async (unmatched, open) => {
    if (!open.length) return [];
    const res = await gateway.complete(ctx, {
      module: "ledger",
      purpose: "recon.match",
      tier: "reasoning",
      maxTokens: 2000,
      responseSchema: {
        type: "object",
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                statementRef: { type: "string" },
                txnId: { type: "string" },
                confidence: { type: "number" },
                reasonCode: { type: "string" }
              },
              required: ["statementRef", "txnId", "confidence"]
            }
          }
        },
        required: ["matches"]
      },
      messages: [
        {
          role: "system",
          content:
            "You reconcile a counterparty statement against our settled transactions. " +
            "Match a statement line to at most one transaction, and only when amount, " +
            "date and reference agree. Leave a line unmatched rather than guessing: an " +
            "unmatched line costs a reviewer a minute, a wrong match costs an audit. " +
            "Confidence is 0-100. Reply as JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({ statementLines: unmatched.slice(0, 200), ourTransactions: open.slice(0, 400) })
        }
      ]
    });
    const parsed = z
      .object({
        matches: z.array(
          z.object({
            statementRef: z.string(),
            txnId: z.string(),
            confidence: z.number().min(0).max(100),
            reasonCode: z.string().optional()
          })
        )
      })
      .safeParse(safeJson(res.text));
    return parsed.success ? parsed.data.matches : [];
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

ledgerRoutes.get("/recon/runs/:id", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:recon:read", { tenantId: ctx.tenantId, module: "ledger" });
  return c.json(await reconSummary(ctx, c.req.param("id")));
});

ledgerRoutes.post("/recon/matches/:id/decide", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "ledger:recon:confirm", { tenantId: ctx.tenantId, module: "ledger" });
  const input = await body(
    c,
    z.object({ decision: z.enum(["confirmed", "rejected"]), reasonCode: z.string().max(64).optional() })
  );
  await decideMatch(ctx, c.req.param("id"), input.decision, input.reasonCode);
  return c.body(null, 204);
});
