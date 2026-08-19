import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@lyra/db";
import { actorRef, audit, require_, diffWords, withIdempotency, type Ctx } from "@lyra/core";
import type { WhitespaceCandidate } from "@lyra/core";
import { body } from "../http.js";
import {
  sweepWhitespace,
  coveragePerLine,
  whitespaceCommentaries,
  whitespaceCommentary
} from "../engines/scout-whitespace.js";
import { promoteWhitespace } from "../engines/scout-promote.js";
import { generateCreatives } from "../engines/signal-creative.js";
import { embedQuery } from "../engines/vectorize.js";
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

/**
 * The commentary a Radar hover shows: why each category is whitespace, in one
 * sentence, plus the evidence it was grounded against. A plain read — every
 * sentence was drafted at sweep time and cached on its row, so this is the
 * prefetch the Radar issues beside the dots and a hover then costs neither a
 * request nor a model call. The payload carries the ✦ + provenance that makes it
 * inspectable (docs/15 §4). `scout:whitespaces:read`, not the promote grant: an
 * analyst who may look at the Radar may read why a row is on it.
 *
 * Registered before the generated CRUD (index.ts), so `commentary` is a path and
 * not read as a whitespace id.
 */
scoutRoutes.get("/whitespaces/commentary", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:whitespaces:read", { tenantId: ctx.tenantId, module: "scout" });
  const limit = Number(c.req.query("limit"));
  return c.json({ data: await whitespaceCommentaries(ctx, Number.isFinite(limit) ? limit : undefined) });
});

/** One row's commentary, same payload as an element of the prefetch above. */
scoutRoutes.get("/whitespaces/:id/commentary", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:whitespaces:read", { tenantId: ctx.tenantId, module: "scout" });
  return c.json(await whitespaceCommentary(ctx, c.req.param("id")));
});

/**
 * Whitespace -> SIGNAL campaign. Approval-gated, idempotent, audited, and
 * announced on the bus (docs/04 §7 `scout.whitespace.promoted`) rather than by
 * reaching into SIGNAL's tables. The creative generator is handed in so the
 * cross-module call happens here, at the composition root, and not between two
 * module engines (CLAUDE.md rule 6).
 */
scoutRoutes.post("/whitespaces/:id/promote-to-signal", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:whitespaces:promote", { tenantId: ctx.tenantId, module: "scout" });
  const whitespaceId = c.req.param("id");
  const result = await withIdempotency(
    ctx,
    c.req.header("idempotency-key"),
    "scout.whitespace.promote",
    { whitespaceId },
    () => promoteWhitespace(ctx, c.get("gateway"), generateCreatives, whitespaceId)
  );
  return c.json(result, 201);
});

const WordingDiffBody = z.object({ textA: z.string().max(50_000), textB: z.string().max(50_000) });

// ADR-0016: PDF-to-text extraction deferred, this takes plain text.
scoutRoutes.post("/wording-diff", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:panel_bench:read", { tenantId: ctx.tenantId, module: "scout" });
  const input = await body(c, WordingDiffBody);
  return c.json({ spans: diffWords(input.textA, input.textB) });
});

const SimilarBody = z.object({ text: z.string().min(1).max(4_000), topK: z.number().int().min(1).max(20).default(10) });

// Signals are embedded into VEC_MARKET on ingest (resources.ts SCOUT signals
// beforeWrite). This is the read side of that index: the nearest neighbours of
// a phrase, so an integrator can see whether what they ingest lands near what
// the harvester already holds. The tenant filter is not optional — one index
// carries every tenant's vectors.
scoutRoutes.post("/signals/similar", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "scout:signals:read", { tenantId: ctx.tenantId, module: "scout" });
  const input = await body(c, SimilarBody);
  const matches = await embedQuery(ctx, c.get("gateway"), c.env.VEC_MARKET, {
    module: "scout",
    purpose: "scout.signal.similar",
    text: input.text,
    topK: input.topK,
    filter: { tenantId: ctx.tenantId }
  });
  // Vectorize holds the vector id, not the row: the signal's own columns come
  // from the database, and a match whose row has been deleted is dropped
  // rather than served as a bare id.
  const rows = matches.length
    ? await ctx.db
        .select({
          id: schema.scoutSignals.id,
          source: schema.scoutSignals.source,
          observedAt: schema.scoutSignals.observedAt,
          embeddingRef: schema.scoutSignals.embeddingRef
        })
        .from(schema.scoutSignals)
        .where(
          and(
            eq(schema.scoutSignals.tenantId, ctx.tenantId),
            inArray(
              schema.scoutSignals.embeddingRef,
              matches.map((one) => one.id)
            )
          )
        )
    : [];
  const byRef = new Map(rows.map((row) => [row.embeddingRef, row]));
  return c.json({
    matches: matches.flatMap((one) => {
      const row = byRef.get(one.id);
      return row ? [{ id: row.id, source: row.source, observedAt: row.observedAt, score: one.score }] : [];
    })
  });
});

scoutRoutes.get("/panel-bench/negotiation-pack", async (c) => {
  const ctx = ctxOf(c);
  // Not scout:panel_bench:read — provider.viewer holds that too, and this pack
  // bakes every provider's price index/win-rate/volume into one PDF for LYRA's
  // own negotiation prep. Handing a provider its counterparty's numbers (or its
  // own prep pack against itself) defeats the tool; gate on an internal-only
  // scout permission instead (scout.pm/lead/admin, never provider.viewer).
  require_(ctx.actor, "scout:whitespaces:promote", { tenantId: ctx.tenantId, module: "scout" });

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
