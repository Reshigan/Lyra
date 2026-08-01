import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@lyra/db";
import { actorRef, audit, require_, diffWords, type Ctx } from "@lyra/core";
import type { WhitespaceCandidate } from "@lyra/core";
import { body } from "../http.js";
import { sweepWhitespace, coveragePerLine } from "../engines/scout-whitespace.js";
import { buildNegotiationPackTables } from "../engines/export/negotiation-pack.js";
import { toPdf } from "../engines/export/pdf.js";
import type { App } from "../env.js";

// docs/modules/scout.md §8 clause 1 (whitespace) and §2.3 (wording diffs feed
// negotiation packs) — three bespoke compute/export routes, same idiom as
// orbit.ts's `/renewals/sweep`: none of these is one-row CRUD.

export const scoutRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

scoutRoutes.post("/whitespaces/compute", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:whitespaces:promote", { tenantId: ctx.tenantId, module: "scout" });
  return c.json({ candidates: await sweepWhitespace(ctx, c.get("gateway")) }, 201);
});

const WordingDiffBody = z.object({ textA: z.string().max(50_000), textB: z.string().max(50_000) });

// ADR-0016: PDF-to-text extraction deferred, this takes plain text.
scoutRoutes.post("/wording-diff", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:panel_bench:read", { tenantId: ctx.tenantId, module: "scout" });
  const input = await body(c, WordingDiffBody);
  return c.json({ spans: diffWords(input.textA, input.textB) });
});

scoutRoutes.get("/panel-bench/negotiation-pack", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:panel_bench:read", { tenantId: ctx.tenantId, module: "scout" });

  const bench = await ctx.db
    .select({
      providerId: schema.scoutPanelBench.providerId,
      line: schema.scoutPanelBench.line,
      period: schema.scoutPanelBench.period,
      ourPriceIdx: schema.scoutPanelBench.ourPriceIdx,
      marketPriceIdx: schema.scoutPanelBench.marketPriceIdx,
      winRate: schema.scoutPanelBench.winRate,
      volume: schema.scoutPanelBench.volume
    })
    .from(schema.scoutPanelBench)
    .where(eq(schema.scoutPanelBench.tenantId, ctx.tenantId));

  const whitespaceRows = await ctx.db
    .select({ category: schema.scoutWhitespaces.category, demandEstimate: schema.scoutWhitespaces.demandEstimate })
    .from(schema.scoutWhitespaces)
    .where(
      and(
        eq(schema.scoutWhitespaces.tenantId, ctx.tenantId),
        inArray(schema.scoutWhitespaces.status, ["candidate", "validating", "validated"])
      )
    );

  // scout_whitespaces never persists a suppressed (below k-anonymity) row, so
  // every one read back here is already `visible: true` by construction — see
  // sweepWhitespace's own filter. coverage is looked up live rather than
  // stored, so the pack always reflects the book as it stands today.
  const coverageByLine = await coveragePerLine(ctx);
  const whitespace: WhitespaceCandidate[] = whitespaceRows
    .filter((w): w is typeof w & { category: string } => w.category !== null)
    .map((w) => ({
      category: w.category,
      momentum: w.demandEstimate ?? 0,
      coverage: coverageByLine.get(w.category) ?? 0,
      cellCount: 0,
      visible: true
    }));

  const tables = buildNegotiationPackTables(bench, whitespace, ctx.now);
  const bytes = toPdf(tables, { meta: { "Requested by": actorRef(ctx) } });

  await audit(ctx, { action: "scout.negotiation_pack.export", subjectRef: "panel-bench", after: { rows: bench.length } });

  const stamp = new Date(ctx.now).toISOString().slice(0, 10);
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="negotiation-pack-${stamp}.pdf"`,
      "cache-control": "no-store"
    }
  });
});
