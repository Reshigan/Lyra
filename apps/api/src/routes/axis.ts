import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@lyra/db";
import { actorRef, audit, badRequest, conflict, emit, notFound, require_, scoped, verifyGroundedness, type Ctx } from "@lyra/core";
import { EXTRACTION_FIELDS, extractionSchema, parseExtraction } from "@lyra/model-gateway";
import { body } from "../http.js";
import { must } from "../rows.js";
import { embedUpsert } from "../engines/vectorize.js";
import { meterEgress } from "../engines/egress.js";
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

const ExtractBody = z.object({
  // ponytail: OCR is out of scope (see model-gateway/extract.ts) — the caller
  // hands over text it already has, not the file itself.
  rawText: z.string().min(1).max(20_000),
  locale: z.enum(["en", "ar"]).default("en")
});

/**
 * docs/04 §4 "documents(+extract)". Structures a document's already-OCR'd text
 * into named fields via the gateway's `responseSchema` (docs/02 §5) — every
 * model call still budgeted, scrubbed, guardrailed and written to
 * ai_audit_log, same as any other gateway.complete() call.
 */
axisRoutes.post("/documents/:id/extract", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:documents:extract", { tenantId: ctx.tenantId, module: "axis" });
  const rowId = c.req.param("id");
  const before = await must(ctx, schema.axisDocuments, rowId, "documents");
  const fields = EXTRACTION_FIELDS[before.docType];
  if (!fields) throw badRequest(`no extraction schema for doc type ${before.docType}`);
  if (before.status !== "received") throw conflict(`document is already ${before.status}`);

  const input = await body(c, ExtractBody);
  await ctx.db
    .update(schema.axisDocuments)
    .set({ status: "extracting" })
    .where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.id, rowId)));

  let result;
  try {
    result = await c.get("gateway").complete(ctx, {
      module: "axis",
      purpose: "axis.document.extract",
      tier: "standard",
      subjectRef: rowId,
      locale: input.locale,
      responseSchema: extractionSchema(fields),
      messages: [
        {
          role: "system",
          content:
            `Extract these fields from the ${before.docType} document text below and reply with ` +
            `JSON only, matching the schema: ${fields.join(", ")}. Locale: ${input.locale}.`
        },
        { role: "user", content: input.rawText }
      ]
    });
  } catch (err) {
    // Nothing stays stuck "extracting" for a call that never landed — the
    // document is exactly as receivable as before this request.
    await ctx.db
      .update(schema.axisDocuments)
      .set({ status: "received" })
      .where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.id, rowId)));
    throw err;
  }

  const { values, confidence } = parseExtraction(result.text, fields);
  const stamp = {
    status: "extracted" as const,
    extractionJson: JSON.stringify(values),
    extractionConfidence: confidence,
    extractionModel: result.model
  };
  await ctx.db
    .update(schema.axisDocuments)
    .set(stamp)
    .where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.id, rowId)));

  const after = { ...before, ...stamp };
  await audit(ctx, { action: "axis.documents.extract", subjectRef: rowId, before, after });
  await emit(ctx, {
    module: "axis",
    type: "axis.document.extracted",
    subject: rowId,
    data: { docType: before.docType, confidence }
  });
  // docs/21 KB search: the extracted text is the only thing worth recalling
  // later, so it's embedded after extraction succeeds, not on upload.
  await embedUpsert(ctx, c.get("gateway"), c.env.VEC_KB, {
    module: "axis",
    purpose: "axis.document.embed",
    id: rowId,
    text: input.rawText,
    metadata: { tenantId: ctx.tenantId, docType: before.docType }
  });
  return c.json(after);
});

const CopilotBody = z.object({
  question: z.string().min(1).max(2000),
  locale: z.enum(["en", "ar"]).default("en")
});

axisRoutes.post("/cases/:id/copilot", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:cases:read", { tenantId: ctx.tenantId, module: "axis" });
  const rowId = c.req.param("id");
  const kase = await must(ctx, schema.axisCases, rowId, "cases");
  const input = await body(c, CopilotBody);

  const [documents, events, tasks] = await Promise.all([
    ctx.db.select().from(schema.axisDocuments).where(scoped(ctx, schema.axisDocuments, eq(schema.axisDocuments.caseId, rowId))),
    ctx.db.select().from(schema.axisProcessEvents).where(scoped(ctx, schema.axisProcessEvents, eq(schema.axisProcessEvents.caseId, rowId))).orderBy(desc(schema.axisProcessEvents.ts)).limit(10),
    ctx.db.select().from(schema.axisTasks).where(scoped(ctx, schema.axisTasks, eq(schema.axisTasks.caseId, rowId)))
  ]);

  const contextLines: string[] = [
    `Case ${kase.ref}: kind ${kase.kind}, status ${kase.status}, priority ${kase.priority}, opened ${new Date(kase.createdAt).toISOString()}` +
      (kase.slaDueAt ? `, SLA due ${new Date(kase.slaDueAt).toISOString()}` : "") +
      (kase.valueMinor !== null ? `, value ${kase.valueMinor / 100} ${kase.currency ?? ""}`.trimEnd() : "") +
      ".",
    ...documents.map((d) => `Document ${d.docType}: status ${d.status}.`),
    ...events.map((e) => `Event ${e.step}: ${e.outcome ?? "in progress"} at ${new Date(e.ts).toISOString()}.`),
    ...tasks.map((t) => `Task ${t.titleKey}: state ${t.state}.`)
  ];

  const result = await c.get("gateway").complete(ctx, {
    module: "axis",
    purpose: "axis.case.copilot",
    tier: "standard",
    subjectRef: rowId,
    locale: input.locale,
    messages: [
      {
        role: "system",
        content:
          "Answer the question about this case using only the context lines below. " +
          "Do not state a number that is not in the context. Locale: " + input.locale + ".\n\n" +
          contextLines.join("\n")
      },
      { role: "user", content: input.question }
    ]
  });

  const groundedness = verifyGroundedness(result.text, contextLines);
  const confidence = groundedness.ok ? 0.95 : Math.max(0.2, 0.95 - groundedness.mismatches.length * 0.15);

  return c.json({
    answer: result.text,
    confidence,
    mismatches: groundedness.mismatches,
    auditId: result.auditId
  });
});

const SampleExtractBody = z.object({
  docType: z.enum(["eid", "mulkiya"]),
  rawText: z.string().min(1).max(20_000),
  locale: z.enum(["en", "ar"]).default("en")
});

/**
 * docs/20 developer console. Same field-extraction call as
 * `/documents/:id/extract`, minus the document row, audit trail and
 * embedding — a scratch space to check a prompt/schema before wiring a real
 * upload. `docType`'s zod enum already limits input to the two keys
 * `EXTRACTION_FIELDS` defines, so there's no missing-schema case to guard.
 */
axisRoutes.post("/dev/extract-sample", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "dev:sandbox:use", { tenantId: ctx.tenantId, module: "dev" });
  const input = await body(c, SampleExtractBody);
  // `docType`'s zod enum limits input to the two keys EXTRACTION_FIELDS defines.
  const fields = EXTRACTION_FIELDS[input.docType]!;

  const result = await c.get("gateway").complete(ctx, {
    module: "axis",
    purpose: "axis.dev.extract_sample",
    tier: "standard",
    locale: input.locale,
    responseSchema: extractionSchema(fields),
    messages: [
      {
        role: "system",
        content:
          `Extract these fields from the ${input.docType} document text below and reply with ` +
          `JSON only, matching the schema: ${fields.join(", ")}. Locale: ${input.locale}.`
      },
      { role: "user", content: input.rawText }
    ]
  });

  const { values, confidence } = parseExtraction(result.text, fields);
  return c.json({ values, confidence, model: result.model });
});

axisRoutes.get("/documents/:id/file", async (c) => {
  const ctx = ctxOf(c);
  require_(ctx.actor, "axis:documents:read", { tenantId: ctx.tenantId, module: "axis" });
  const doc = await must(ctx, schema.axisDocuments, c.req.param("id"), "document");
  const file = await must(ctx, schema.files, doc.fileId, "document file");
  const object = await c.env.FILES?.get(file.r2Key);
  if (!object) throw notFound("document file");

  await audit(ctx, {
    action: "axis.documents.file.read",
    subjectRef: `axis_document:${doc.id}`,
    after: { fileId: file.id }
  });
  await meterEgress(ctx, file.sizeBytes ?? object.size);
  return new Response(object.body, {
    headers: {
      "content-type": file.contentType ?? "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": "no-store"
    }
  });
});
