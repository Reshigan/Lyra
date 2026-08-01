import { Hono } from "hono";
import { z } from "zod";
import type { ReportTable } from "@lyra/ledger";
import { id, schema } from "@lyra/db";
import { actorRef, audit, require_, sha256Hex, type Ctx } from "@lyra/core";
import { body } from "../http.js";
import { generateBriefing } from "../engines/narrator.js";
import { assembleBoardpackSections } from "../engines/north-boardpack.js";
import { toPdf } from "../engines/export/pdf.js";
import { pushToActor } from "../engines/realtime.js";
import type { App } from "../env.js";

// docs/modules/north.md §2.2 (daily brief) and §2.5/§8 (board pack, one
// click). Two bespoke routes, same idiom as signal.ts/scout.ts: gate, call
// the engine, respond. Neither is one-row CRUD.

export const northRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");

const GenerateBriefingBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  audience: z.string().optional(),
  locale: z.string().optional()
});

// engines/narrator.ts was complete (snapshot build, gateway call, numeric-claim
// verification, DB insert) but had no caller until this route.
northRoutes.post("/briefings/generate", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "north:briefings:generate", { tenantId: ctx.tenantId, module: "north" });
  const input = await body(c, GenerateBriefingBody);
  const result = await generateBriefing(ctx, c.get("gateway"), {
    date: input.date,
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {})
  });
  await pushToActor(c.env, ctx.tenantId, ctx.actor.id, "north.briefing.generated", { id: result.id }, ctx.now);
  return c.json(result, 201);
});

const GenerateBoardpackBody = z.object({ period: z.string().min(1), title: z.string().min(1).max(200) });

// Mounted before generic CRUD (index.ts), so this real assembly+render wins
// over the generated create for the same path — which would otherwise accept
// arbitrary sectionsJson/pdfFileId straight from the client with no render
// behind it. Status lands on "review", never "final": rule 4 (human-in-the-
// loop) — distribution is the consequential step (docs/modules/north.md §3),
// not assembly, and no approval/distribution route exists yet (ADR-0017).
northRoutes.post("/boardpacks", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "north:boardpacks:generate", { tenantId: ctx.tenantId, module: "north" });
  const input = await body(c, GenerateBoardpackBody);

  const sections = await assembleBoardpackSections(ctx, input.period);
  const tables: ReportTable[] = [sections.briefing, sections.metrics, sections.decisions];
  const bytes = toPdf(tables, { footer: ctx.tenantId, meta: { Period: input.period, "Requested by": actorRef(ctx) } });

  const boardpackId = id("bpk", ctx.now);
  const fileId = id("file", ctx.now);
  const r2Key = `boardpacks/${ctx.tenantId}/${boardpackId}.pdf`;
  const bucket = c.env.FILES;
  if (bucket) await bucket.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" } });

  await ctx.db.insert(schema.files).values({
    id: fileId,
    tenantId: ctx.tenantId,
    r2Key,
    kind: "north_boardpack",
    subjectRef: boardpackId,
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    contentType: "application/pdf",
    piiLevel: "none",
    createdAt: ctx.now,
    deletedAt: null
  });

  const row = {
    id: boardpackId,
    tenantId: ctx.tenantId,
    period: input.period,
    title: input.title,
    sectionsJson: JSON.stringify(tables),
    pdfFileId: bucket ? fileId : null,
    xlsxFileId: null,
    distributionLogJson: "[]",
    status: bucket ? "review" : "draft",
    approvedBy: null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.northBoardpacks).values(row);
  await audit(ctx, {
    action: "north.boardpack.generate",
    subjectRef: boardpackId,
    after: { period: input.period, rows: tables.reduce((n, t) => n + t.rows.length, 0) }
  });
  await pushToActor(c.env, ctx.tenantId, ctx.actor.id, "north.boardpack.generated", { id: boardpackId }, ctx.now);

  return c.json(row, 201);
});
