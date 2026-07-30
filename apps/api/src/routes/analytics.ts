import { Hono } from "hono";
import { desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { id, schema } from "@lyra/db";
import {
  actorRef,
  audit,
  badRequest,
  can,
  conflict,
  forbidden,
  gate,
  notFound,
  require_,
  scoped,
  sha256Hex,
  type Ctx
} from "@lyra/core";
import type { ReportTable } from "@lyra/ledger";
import { DATASETS, MAX_ROWS, runReport, totalsOf, type ReportDefinition, type RunResult } from "../engines/report.js";
import { toXlsx } from "../engines/export/xlsx.js";
import { pdfSafe, toPdf } from "../engines/export/pdf.js";
import { body, listParams } from "../http.js";
import { must } from "../rows.js";
import type { App } from "../env.js";

// docs/09. Reporting that a finance team will actually accept: a definition it
// can read, a run it can repeat, and a file it can attach to an email. The
// engine is in engines/report.ts; this file is permissions, persistence and
// bytes — the three things the engine deliberately does not know about.

export const analyticsRoutes = new Hono<App>();

/* ------------------------------------------------------------- semantic layer */

/** What a report builder can offer the user. Derived, never hand-maintained. */
analyticsRoutes.get("/datasets", (c) => {
  const ctx = c.get("ctx");
  const data = Object.entries(DATASETS)
    .filter(([, ds]) => can(ctx.actor, ds.permission, { tenantId: ctx.tenantId, module: ds.module }))
    .map(([key, ds]) => ({
      key,
      module: ds.module,
      timeColumn: ds.timeColumn,
      dimensions: Object.entries(ds.dimensions).map(([k, d]) => ({ key: k, label: d.label, kind: d.kind, pii: Boolean(d.pii) })),
      metrics: Object.entries(ds.metrics).map(([k, m]) => ({ key: k, label: m.label, kind: m.kind, agg: m.agg }))
    }));
  return c.json({ data });
});

/* -------------------------------------------------------------------- reports */

const Filter = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "contains", "is_null", "not_null"]),
  value: z.union([z.string().max(200), z.number(), z.array(z.union([z.string().max(200), z.number()])).max(200)]).optional()
});

const Definition = z.object({
  dataset: z.string().min(1).max(64),
  metrics: z.array(z.string().min(1).max(64)).min(1).max(12),
  dimensions: z.array(z.string().min(1).max(64)).max(6).optional(),
  filters: z.array(Filter).max(20).optional(),
  grain: z.enum(["none", "day", "week", "month", "quarter", "year"]).optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  sort: z.object({ field: z.string().min(1).max(64), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional()
});

const ReportBody = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_.-]+$/),
  module: z.string().min(1).max(32),
  name: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).optional(),
  definition: Definition,
  piiLevel: z.enum(["none", "low", "high"]).default("none"),
  scope: z.enum(["tenant", "team", "personal"]).default("tenant")
});

analyticsRoutes.get("/reports", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:read", { tenantId: ctx.tenantId });
  const { list } = listParams(c);
  const rows = await ctx.db
    .select()
    .from(schema.reports)
    .where(
      scoped(
        ctx,
        schema.reports,
        // Personal reports belong to their owner; tenant and team scopes are shared.
        or(eq(schema.reports.scope, "tenant"), eq(schema.reports.scope, "team"), eq(schema.reports.ownerRef, actorRef(ctx)))
      )
    )
    .orderBy(desc(schema.reports.updatedAt))
    .limit(list.limit);
  return c.json({ data: rows.filter((r) => can(ctx.actor, r.requiredPermission, { tenantId: ctx.tenantId, module: r.module })) });
});

analyticsRoutes.post("/reports", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:write", { tenantId: ctx.tenantId });
  const input = await body(c, ReportBody);
  const ds = DATASETS[input.definition.dataset];
  if (!ds) throw badRequest(`unknown dataset ${input.definition.dataset}`);
  // The report inherits the dataset's permission rather than accepting one from
  // the caller — otherwise a report is a way to relabel data as less sensitive.
  const row = {
    id: id("rep", ctx.now),
    tenantId: ctx.tenantId,
    key: input.key,
    module: ds.module,
    nameJson: JSON.stringify(input.name),
    descriptionJson: input.description ? JSON.stringify(input.description) : null,
    definitionJson: JSON.stringify(input.definition),
    piiLevel: input.piiLevel,
    requiredPermission: ds.permission,
    ownerRef: actorRef(ctx),
    scope: input.scope,
    system: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null
  };
  await ctx.db.insert(schema.reports).values(row);
  await audit(ctx, { action: "analytics.report.create", subjectRef: row.id, after: row });
  return c.json(row, 201);
});

analyticsRoutes.get("/reports/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:read", { tenantId: ctx.tenantId });
  return c.json(await readableReport(ctx, c.req.param("id")));
});

analyticsRoutes.patch("/reports/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:write", { tenantId: ctx.tenantId });
  const before = await must(ctx, schema.reports, c.req.param("id"), "report");
  if (before.system) throw conflict("a system report cannot be edited; clone it first");
  const input = await body(c, ReportBody.partial());

  const patch: Record<string, unknown> = { updatedAt: ctx.now };
  if (input.name) patch.nameJson = JSON.stringify(input.name);
  if (input.description) patch.descriptionJson = JSON.stringify(input.description);
  if (input.piiLevel) patch.piiLevel = input.piiLevel;
  if (input.scope) patch.scope = input.scope;
  if (input.definition) {
    const ds = DATASETS[input.definition.dataset];
    if (!ds) throw badRequest(`unknown dataset ${input.definition.dataset}`);
    patch.definitionJson = JSON.stringify(input.definition);
    patch.module = ds.module;
    patch.requiredPermission = ds.permission;
  }
  await ctx.db.update(schema.reports).set(patch).where(scoped(ctx, schema.reports, eq(schema.reports.id, before.id)));
  await audit(ctx, { action: "analytics.report.update", subjectRef: before.id, before, after: patch });
  return c.json({ ...before, ...patch });
});

analyticsRoutes.delete("/reports/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:write", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.reports, c.req.param("id"), "report");
  if (row.system) throw conflict("a system report cannot be deleted");
  await ctx.db
    .update(schema.reports)
    .set({ deletedAt: ctx.now, updatedAt: ctx.now })
    .where(scoped(ctx, schema.reports, eq(schema.reports.id, row.id)));
  await audit(ctx, { action: "analytics.report.delete", subjectRef: row.id, before: row });
  return c.body(null, 204);
});

/* ----------------------------------------------------------------------- runs */

const RunBody = z.object({
  /** Overrides merged over the stored definition — the "same report, last week" case. */
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  filters: z.array(Filter).max(20).optional(),
  grain: z.enum(["none", "day", "week", "month", "quarter", "year"]).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
  totals: z.boolean().default(true)
});

analyticsRoutes.post("/reports/:id/run", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:run", { tenantId: ctx.tenantId });
  const report = await readableReport(ctx, c.req.param("id"));
  const overrides = await body(c, RunBody);
  const def = mergeDefinition(report.definitionJson, overrides);
  const { result, runId } = await materialise(ctx, def, { reportId: report.id, title: labelOf(report.nameJson, ctx.locale) });
  return c.json({ runId, ...result, ...(overrides.totals ? { totals: totalsOf(result) } : {}) }, 201);
});

/** Ad-hoc: build a definition in the UI and run it without saving. */
analyticsRoutes.post("/run", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:run", { tenantId: ctx.tenantId });
  const input = await body(c, Definition.extend({ totals: z.boolean().default(true) }));
  const { totals, ...def } = input;
  requireDataset(ctx, def.dataset);
  const { result, runId } = await materialise(ctx, def, {});
  return c.json({ runId, ...result, ...(totals ? { totals: totalsOf(result) } : {}) }, 201);
});

analyticsRoutes.get("/runs/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:read", { tenantId: ctx.tenantId });
  return c.json(await must(ctx, schema.reportRuns, c.req.param("id"), "run"));
});

/* -------------------------------------------------------------------- exports */

const ExportBody = z.object({
  format: z.enum(["xlsx", "pdf", "csv", "json"]),
  reportId: z.string().optional(),
  definition: Definition.optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  filters: z.array(Filter).max(20).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
  totals: z.boolean().default(true),
  /** Ask for real identifiers instead of masked ones. Dual control, always. */
  unmasked: z.boolean().default(false),
  piiJustification: z.string().min(10).max(500).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional()
});

analyticsRoutes.post("/exports", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:exports:create", { tenantId: ctx.tenantId });
  const input = await body(c, ExportBody);

  let def: ReportDefinition;
  let title = "Export";
  let reportId: string | null = null;
  if (input.reportId) {
    const report = await readableReport(ctx, input.reportId);
    def = mergeDefinition(report.definitionJson, input);
    title = labelOf(report.nameJson, ctx.locale);
    reportId = report.id;
  } else if (input.definition) {
    def = { ...input.definition, ...(input.filters ? { filters: input.filters } : {}) };
    requireDataset(ctx, def.dataset);
    title = `${def.dataset} export`;
  } else {
    throw badRequest("an export needs either reportId or definition");
  }

  // Unmasking is the one thing here that can turn a report into a data breach,
  // so it needs the permission, a written reason, and a second person.
  let approvedBy: string | null = null;
  if (input.unmasked) {
    require_(ctx.actor, "analytics:exports:unmasked", { tenantId: ctx.tenantId });
    if (!input.piiJustification) throw badRequest("an unmasked export needs piiJustification");
    const approval = await gate(ctx, {
      policyKey: "core.unmasked_export",
      subjectRef: reportId ?? `dataset:${def.dataset}`,
      context: { reason: input.piiJustification, format: input.format, dataset: def.dataset }
    });
    approvedBy = approval?.id ?? "auto";
  }

  const { result, runId } = await materialise(ctx, def, {
    ...(reportId ? { reportId } : {}),
    title,
    unmasked: input.unmasked
  });
  const totals = input.totals ? totalsOf(result) : undefined;

  // Watermark every unmasked artefact with who asked and when. A leaked PDF that
  // names its recipient is traceable; an anonymous one is not.
  const watermark = input.unmasked ? `${actorRef(ctx)} · ${new Date(ctx.now).toISOString().slice(0, 19)}` : undefined;
  const rendered = render(input.format, result, {
    ...(totals ? { totals } : {}),
    ...(watermark ? { watermark } : {}),
    ...(input.orientation ? { orientation: input.orientation } : {}),
    meta: { "Requested by": actorRef(ctx), Rows: String(result.rowCount), ...(input.unmasked ? { Access: "UNMASKED" } : {}) }
  });

  const exportId = id("exp", ctx.now);
  const fileId = id("file", ctx.now);
  const r2Key = `exports/${ctx.tenantId}/${exportId}.${input.format}`;
  const bucket = c.env.FILES;
  if (bucket) await bucket.put(r2Key, rendered.bytes, { httpMetadata: { contentType: rendered.contentType } });

  await ctx.db.insert(schema.files).values({
    id: fileId,
    tenantId: ctx.tenantId,
    r2Key,
    kind: "analytics_export",
    subjectRef: exportId,
    sha256: await sha256Hex(rendered.bytes),
    sizeBytes: rendered.bytes.length,
    contentType: rendered.contentType,
    piiLevel: input.unmasked ? "high" : "none",
    createdAt: ctx.now,
    deletedAt: null
  });

  const row = {
    id: exportId,
    tenantId: ctx.tenantId,
    runId,
    reportId,
    subjectRef: null,
    format: input.format,
    fileId,
    sizeBytes: rendered.bytes.length,
    rowCount: result.rowCount,
    piiMasked: !input.unmasked,
    piiJustification: input.piiJustification ?? null,
    watermark: watermark ?? null,
    requestedBy: actorRef(ctx),
    approvedBy,
    // Rendering happens inline: these reports are bounded by MAX_ROWS, and a
    // queue for something that takes 200ms is a queue to debug at 3am.
    state: bucket ? "ready" : "failed",
    downloadCount: 0,
    expiresAt: ctx.now + 7 * 24 * 60 * 60 * 1000,
    error: bucket ? null : "no object store bound",
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.analyticsExports).values(row);
  await audit(ctx, {
    action: "analytics.export.create",
    subjectRef: exportId,
    after: { format: input.format, rows: result.rowCount, unmasked: input.unmasked, reportId }
  });
  return c.json(row, 201);
});

analyticsRoutes.get("/exports", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:exports:create", { tenantId: ctx.tenantId });
  const { list } = listParams(c);
  const mine = can(ctx.actor, "core:audit:read", { tenantId: ctx.tenantId })
    ? undefined
    : eq(schema.analyticsExports.requestedBy, actorRef(ctx));
  const rows = await ctx.db
    .select()
    .from(schema.analyticsExports)
    .where(scoped(ctx, schema.analyticsExports, mine))
    .orderBy(desc(schema.analyticsExports.createdAt))
    .limit(list.limit);
  return c.json({ data: rows });
});

analyticsRoutes.get("/exports/:id/download", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:exports:download", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.analyticsExports, c.req.param("id"), "export");
  if (row.state !== "ready" || !row.fileId) throw notFound("export file");
  if (row.expiresAt && row.expiresAt < ctx.now) throw notFound("export file");
  // An unmasked export is readable only by the person who justified it, or by
  // someone who could have approved it.
  if (!row.piiMasked && row.requestedBy !== actorRef(ctx)) {
    require_(ctx.actor, "analytics:exports:unmasked", { tenantId: ctx.tenantId });
  }

  const file = await must(ctx, schema.files, row.fileId, "file");
  const bucket = c.env.FILES;
  const object = bucket ? await bucket.get(file.r2Key) : null;
  if (!object) throw notFound("export file");

  await ctx.db
    .update(schema.analyticsExports)
    .set({ downloadCount: row.downloadCount + 1, updatedAt: ctx.now })
    .where(scoped(ctx, schema.analyticsExports, eq(schema.analyticsExports.id, row.id)));
  // Every download of a PII artefact is an audit event, not a metric.
  await audit(ctx, { action: "analytics.export.download", subjectRef: row.id, after: { piiMasked: row.piiMasked } });

  return new Response(object.body, {
    headers: {
      "content-type": file.contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${row.id}.${row.format}"`,
      "cache-control": "no-store"
    }
  });
});

/* ------------------------------------------------------------------ schedules */

const ScheduleBody = z.object({
  reportId: z.string().optional(),
  dashboardId: z.string().optional(),
  name: z.record(z.string(), z.string()),
  cron: z.string().min(9).max(64),
  timezone: z.string().min(3).max(64).default("Asia/Dubai"),
  format: z.enum(["xlsx", "pdf", "csv", "json"]).default("pdf"),
  recipients: z.array(z.string().min(3).max(200)).min(1).max(50),
  params: z.record(z.string(), z.unknown()).optional(),
  locale: z.enum(["en", "ar"]).default("en"),
  status: z.enum(["active", "paused"]).default("active")
});

analyticsRoutes.get("/schedules", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:schedules:read", { tenantId: ctx.tenantId });
  const rows = await ctx.db
    .select()
    .from(schema.analyticsSchedules)
    .where(scoped(ctx, schema.analyticsSchedules))
    .orderBy(desc(schema.analyticsSchedules.updatedAt))
    .limit(200);
  return c.json({ data: rows });
});

analyticsRoutes.post("/schedules", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:schedules:write", { tenantId: ctx.tenantId });
  const input = await body(c, ScheduleBody);
  if (!input.reportId && !input.dashboardId) throw badRequest("a schedule needs a reportId or a dashboardId");
  if (input.reportId) await readableReport(ctx, input.reportId);
  const next = nextRun(input.cron, ctx.now);

  const row = {
    id: id("sch", ctx.now),
    tenantId: ctx.tenantId,
    reportId: input.reportId ?? null,
    dashboardId: input.dashboardId ?? null,
    nameJson: JSON.stringify(input.name),
    cron: input.cron,
    timezone: input.timezone,
    format: input.format,
    // Delivery is consent-checked at send time (docs/12 §4); storing an address
    // here is not permission to mail it.
    recipientsJson: JSON.stringify(input.recipients),
    paramsJson: input.params ? JSON.stringify(input.params) : null,
    locale: input.locale,
    status: input.status,
    lastRunAt: null,
    lastState: null,
    nextRunAt: next,
    createdBy: actorRef(ctx),
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.analyticsSchedules).values(row);
  await audit(ctx, { action: "analytics.schedule.create", subjectRef: row.id, after: row });
  return c.json(row, 201);
});

analyticsRoutes.post("/schedules/:id/pause", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:schedules:write", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.analyticsSchedules, c.req.param("id"), "schedule");
  await ctx.db
    .update(schema.analyticsSchedules)
    .set({ status: "paused", nextRunAt: null, updatedAt: ctx.now })
    .where(scoped(ctx, schema.analyticsSchedules, eq(schema.analyticsSchedules.id, row.id)));
  await audit(ctx, { action: "analytics.schedule.pause", subjectRef: row.id });
  return c.body(null, 204);
});

analyticsRoutes.post("/schedules/:id/resume", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:schedules:write", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.analyticsSchedules, c.req.param("id"), "schedule");
  await ctx.db
    .update(schema.analyticsSchedules)
    .set({ status: "active", nextRunAt: nextRun(row.cron, ctx.now), updatedAt: ctx.now })
    .where(scoped(ctx, schema.analyticsSchedules, eq(schema.analyticsSchedules.id, row.id)));
  await audit(ctx, { action: "analytics.schedule.resume", subjectRef: row.id });
  return c.body(null, 204);
});

analyticsRoutes.delete("/schedules/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:schedules:write", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.analyticsSchedules, c.req.param("id"), "schedule");
  await ctx.db.delete(schema.analyticsSchedules).where(scoped(ctx, schema.analyticsSchedules, eq(schema.analyticsSchedules.id, row.id)));
  await audit(ctx, { action: "analytics.schedule.delete", subjectRef: row.id, before: row });
  return c.body(null, 204);
});

/* ----------------------------------------------------------------- dashboards */

const DashboardBody = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_.-]+$/),
  module: z.string().min(1).max(32),
  name: z.record(z.string(), z.string()),
  layout: z.object({
    tiles: z
      .array(
        z.object({
          key: z.string().min(1).max(64),
          viz: z.enum(["number", "line", "bar", "table", "donut", "list"]),
          span: z.number().int().min(1).max(12).default(4),
          reportId: z.string().optional(),
          definition: Definition.optional()
        })
      )
      .max(24)
  }),
  scope: z.enum(["tenant", "team", "personal"]).default("tenant"),
  roles: z.array(z.string()).max(30).optional(),
  isDefault: z.boolean().default(false)
});

analyticsRoutes.get("/dashboards", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:dashboards:read", { tenantId: ctx.tenantId });
  const roles = new Set(ctx.actor.grants.map((g) => g.roleKey));
  const rows = await ctx.db
    .select()
    .from(schema.dashboards)
    .where(scoped(ctx, schema.dashboards))
    .orderBy(desc(schema.dashboards.isDefault))
    .limit(200);
  // A roles list narrows visibility; no list means "anyone who can read dashboards".
  return c.json({
    data: rows.filter((r) => {
      const allowed = r.rolesJson ? (JSON.parse(r.rolesJson) as string[]) : null;
      const owned = r.scope !== "personal" || r.ownerRef === actorRef(ctx);
      return owned && (!allowed?.length || allowed.some((role) => roles.has(role)));
    })
  });
});

analyticsRoutes.post("/dashboards", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:dashboards:write", { tenantId: ctx.tenantId });
  const input = await body(c, DashboardBody);
  for (const tile of input.layout.tiles) {
    if (tile.definition) requireDataset(ctx, tile.definition.dataset);
  }
  const row = {
    id: id("dsh", ctx.now),
    tenantId: ctx.tenantId,
    key: input.key,
    module: input.module,
    nameJson: JSON.stringify(input.name),
    layoutJson: JSON.stringify(input.layout),
    scope: input.scope,
    ownerRef: actorRef(ctx),
    rolesJson: input.roles ? JSON.stringify(input.roles) : null,
    isDefault: input.isDefault,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.dashboards).values(row);
  await audit(ctx, { action: "analytics.dashboard.create", subjectRef: row.id, after: row });
  return c.json(row, 201);
});

/** One call paints the whole dashboard — a tile per round trip is a slow page. */
analyticsRoutes.get("/dashboards/:id/data", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:dashboards:read", { tenantId: ctx.tenantId });
  const dash = await must(ctx, schema.dashboards, c.req.param("id"), "dashboard");
  const layout = JSON.parse(dash.layoutJson) as { tiles: { key: string; reportId?: string; definition?: ReportDefinition }[] };

  const tiles = await Promise.all(
    layout.tiles.map(async (tile) => {
      try {
        const def = tile.definition
          ? tile.definition
          : tile.reportId
            ? (JSON.parse((await readableReport(ctx, tile.reportId)).definitionJson) as ReportDefinition)
            : null;
        if (!def) return { key: tile.key, error: "tile has no definition" };
        requireDataset(ctx, def.dataset);
        const table = await runReport(ctx, def, { title: tile.key });
        return { key: tile.key, table, totals: totalsOf(table) };
      } catch (err) {
        // One dead tile must not blank the dashboard.
        return { key: tile.key, error: err instanceof Error ? err.message : "failed" };
      }
    })
  );
  return c.json({ id: dash.id, key: dash.key, layout, tiles, generatedAt: ctx.now });
});

/* ---------------------------------------------------------------- saved views */

const SavedViewBody = z.object({
  route: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  query: z.record(z.string(), z.unknown()),
  columns: z.array(z.string()).max(60).optional(),
  isDefault: z.boolean().default(false),
  shared: z.boolean().default(false)
});

analyticsRoutes.get("/saved-views", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:saved_views:read", { tenantId: ctx.tenantId });
  const route = c.req.query("route");
  const rows = await ctx.db
    .select()
    .from(schema.savedViews)
    .where(
      scoped(
        ctx,
        schema.savedViews,
        route ? eq(schema.savedViews.route, route) : undefined,
        or(isNull(schema.savedViews.userId), eq(schema.savedViews.userId, ctx.actor.id))
      )
    )
    .orderBy(desc(schema.savedViews.isDefault))
    .limit(200);
  return c.json({ data: rows });
});

analyticsRoutes.post("/saved-views", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:saved_views:write", { tenantId: ctx.tenantId });
  const input = await body(c, SavedViewBody);
  const row = {
    id: id("sv", ctx.now),
    tenantId: ctx.tenantId,
    userId: input.shared ? null : ctx.actor.id,
    route: input.route,
    name: input.name,
    queryJson: JSON.stringify(input.query),
    columnsJson: input.columns ? JSON.stringify(input.columns) : null,
    isDefault: input.isDefault,
    sharedWithJson: null,
    createdAt: ctx.now,
    updatedAt: ctx.now
  };
  await ctx.db.insert(schema.savedViews).values(row);
  return c.json(row, 201);
});

analyticsRoutes.delete("/saved-views/:id", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:saved_views:write", { tenantId: ctx.tenantId });
  const row = await must(ctx, schema.savedViews, c.req.param("id"), "saved view");
  if (row.userId && row.userId !== ctx.actor.id) throw forbidden("analytics:saved_views:write");
  await ctx.db.delete(schema.savedViews).where(scoped(ctx, schema.savedViews, eq(schema.savedViews.id, row.id)));
  return c.body(null, 204);
});

/* ------------------------------------------------------------ unit economics */

/** Cost per outcome (NFR-013). The number that says whether AI is paying for itself. */
analyticsRoutes.get("/unit-economics", async (c) => {
  const ctx = c.get("ctx");
  require_(ctx.actor, "analytics:reports:read", { tenantId: ctx.tenantId });
  const since = Number(c.req.query("since") ?? 0);
  const rows = await ctx.db
    .select()
    .from(schema.unitEconomics)
    .where(scoped(ctx, schema.unitEconomics, since ? sql`${schema.unitEconomics.updatedAt} >= ${since}` : undefined))
    .orderBy(desc(schema.unitEconomics.day))
    .limit(1000);

  const data = rows.map((r) => {
    const cost = r.aiCostMicro + r.mediaCostMicro;
    return {
      ...r,
      // Micro-units to minor units: 1_000_000 micro = 1 major = 100 minor.
      costMinor: Math.round(cost / 10_000),
      costPerUnitMinor: r.volume ? Math.round(cost / 10_000 / r.volume) : null,
      marginMinor: r.revenueMinor - Math.round(cost / 10_000)
    };
  });
  return c.json({ data });
});

/* ------------------------------------------------------------------- helpers */

async function readableReport(ctx: Ctx, reportId: string): Promise<typeof schema.reports.$inferSelect> {
  const row = await must(ctx, schema.reports, reportId, "report");
  // The report's own permission is the gate — `analytics:reports:read` gets you
  // the list, not the contents of a report about a module you cannot see.
  require_(ctx.actor, row.requiredPermission, { tenantId: ctx.tenantId, module: row.module });
  if (row.scope === "personal" && row.ownerRef !== actorRef(ctx)) throw notFound("report");
  return row;
}

function requireDataset(ctx: Ctx, dataset: string): void {
  const ds = DATASETS[dataset];
  if (!ds) throw badRequest(`unknown dataset ${dataset}`);
  require_(ctx.actor, ds.permission, { tenantId: ctx.tenantId, module: ds.module });
}

function mergeDefinition(
  definitionJson: string,
  over: Partial<Pick<ReportDefinition, "from" | "to" | "filters" | "grain" | "limit">>
): ReportDefinition {
  const base = JSON.parse(definitionJson) as ReportDefinition;
  return {
    ...base,
    ...(over.from !== undefined ? { from: over.from } : {}),
    ...(over.to !== undefined ? { to: over.to } : {}),
    ...(over.grain !== undefined ? { grain: over.grain } : {}),
    ...(over.limit !== undefined ? { limit: over.limit } : {}),
    // Overriding filters replaces rather than appends: a caller who cannot see
    // the stored filters cannot reason about what appending would produce.
    ...(over.filters ? { filters: over.filters } : {})
  };
}

/** Run it, and leave a row saying it ran. A report nobody can prove ran is a rumour. */
async function materialise(
  ctx: Ctx,
  def: ReportDefinition,
  opts: { reportId?: string; title?: string; unmasked?: boolean }
): Promise<{ result: RunResult; runId: string }> {
  const runId = id("run", ctx.now);
  const started = Date.now();
  const unmasked = opts.unmasked ?? can(ctx.actor, "core:pii:view", { tenantId: ctx.tenantId });
  try {
    const result = await runReport(ctx, def, { unmasked, ...(opts.title ? { title: opts.title } : {}) });
    await ctx.db.insert(schema.reportRuns).values({
      id: runId,
      tenantId: ctx.tenantId,
      reportId: opts.reportId ?? "adhoc",
      paramsJson: JSON.stringify(def),
      requestedBy: actorRef(ctx),
      trigger: "user",
      state: "done",
      rowCount: result.rowCount,
      resultRef: null,
      truncated: result.truncated,
      durationMs: Date.now() - started,
      error: null,
      expiresAt: ctx.now + 24 * 60 * 60 * 1000,
      startedAt: ctx.now,
      endedAt: Date.now()
    });
    return { result, runId };
  } catch (err) {
    await ctx.db.insert(schema.reportRuns).values({
      id: runId,
      tenantId: ctx.tenantId,
      reportId: opts.reportId ?? "adhoc",
      paramsJson: JSON.stringify(def),
      requestedBy: actorRef(ctx),
      trigger: "user",
      state: "failed",
      truncated: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "failed",
      startedAt: ctx.now,
      endedAt: Date.now()
    });
    throw err;
  }
}

interface Rendered {
  bytes: Uint8Array;
  contentType: string;
}

function render(
  format: "xlsx" | "pdf" | "csv" | "json",
  table: ReportTable & { rowCount?: number },
  opts: { totals?: Record<string, number>; watermark?: string; orientation?: "portrait" | "landscape"; meta?: Record<string, string> }
): Rendered {
  switch (format) {
    case "xlsx":
      return {
        bytes: toXlsx([table], opts),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      };
    case "pdf": {
      // Arabic needs an embedded font the base-14 set does not have, so rather
      // than draw question marks the caller is told to ask for XLSX.
      if (!pdfSafe([table])) throw badRequest("this report contains non-Latin text; export it as xlsx");
      return { bytes: toPdf([table], opts), contentType: "application/pdf" };
    }
    case "csv":
      return { bytes: new TextEncoder().encode(toCsv(table)), contentType: "text/csv; charset=utf-8" };
    default:
      return {
        bytes: new TextEncoder().encode(JSON.stringify({ ...table, totals: opts.totals }, null, 2)),
        contentType: "application/json"
      };
  }
}

function toCsv(table: ReportTable): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = table.columns.map((c) => esc(c.label)).join(",");
  const rows = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(","));
  // A leading BOM so Excel opens UTF-8 CSV without mangling Arabic.
  // eslint-disable-next-line no-irregular-whitespace
  return `﻿${[head, ...rows].join("\r\n")}\r\n`;
}

/**
 * Next fire time for a five-field cron, evaluated in UTC by minute stepping.
 * ponytail: a minute-by-minute scan over at most 366 days. It runs once per
 * schedule write, not per tick — swap for a field-wise solver if that changes.
 */
export function nextRun(cron: string, from: number): number | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw badRequest("cron must have five fields: minute hour dom month dow");
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];

  const matches = (spec: string, value: number, max: number): boolean => {
    if (spec === "*") return true;
    return spec.split(",").some((part) => {
      const [range, stepRaw] = part.split("/");
      const step = stepRaw ? Number(stepRaw) : 1;
      if (!Number.isFinite(step) || step < 1) return false;
      if (range === "*" || range === undefined) return value % step === 0;
      const [aRaw, bRaw] = range.split("-");
      const a = Number(aRaw);
      const b = bRaw === undefined ? a : Number(bRaw);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > max) return false;
      return value >= a && value <= b && (value - a) % step === 0;
    });
  };

  const cursor = new Date(Math.ceil((from + 60_000) / 60_000) * 60_000);
  const limit = from + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limit) {
    if (
      matches(min, cursor.getUTCMinutes(), 59) &&
      matches(hour, cursor.getUTCHours(), 23) &&
      matches(dom, cursor.getUTCDate(), 31) &&
      matches(month, cursor.getUTCMonth() + 1, 12) &&
      matches(dow, cursor.getUTCDay(), 6)
    ) {
      return cursor.getTime();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

function labelOf(nameJson: string, locale: string): string {
  try {
    const map = JSON.parse(nameJson) as Record<string, string>;
    return map[locale] ?? map.en ?? Object.values(map)[0] ?? "Report";
  } catch {
    return "Report";
  }
}
