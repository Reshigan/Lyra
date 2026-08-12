import { id, schema } from "@lyra/db";
import { DAY, HOUR, MINUTE, type SeedContext } from "./context.js";
import { monthName } from "./period.js";

// The analytics workspace in the demo tenant. Every row here reports on data the
// core seed has already written — Rania Haddad's motor quote, the four
// underwriters who answered it, the Cedar policy that came out of it and the
// commission booked against it — so the dashboards, reports and unit economics
// tell the same story as the rest of the workspace rather than a parallel one
// invented for the charts.
//
// Nothing in this file runs a report: a report row is a definition over the
// semantic layer (apps/api/src/engines/report.ts), and every dataset, dimension
// and metric named below is a key that registry actually declares. A definition
// naming anything else renders as a dead tile instead of a picture.

/** The day key unit economics is bucketed on, derived from the seed clock. */
function day(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * The next occurrence of a UTC time-of-day after `from`. Schedules need a
 * `nextRunAt` in the future or the first scheduled tick after install runs them
 * all at once; the API owns real cron expansion, so this is only enough to place
 * the demo's next slot. GONXT runs on Asia/Dubai, which is UTC+4 with no DST, so
 * 07:00 local is 03:00 UTC.
 */
function nextAt(from: number, utcOffsetMs: number): number {
  let at = from - (from % DAY) + utcOffsetMs;
  while (at <= from) at += DAY;
  return at;
}

export async function seedAnalytics(ctx: SeedContext): Promise<void> {
  const { db, now, tenantId } = ctx;

  const who = (roleKey: string): string => {
    const userId = ctx.users[roleKey];
    if (!userId) throw new Error(`seed: no user for ${roleKey}`);
    return userId;
  };
  const ref = (roleKey: string): string => `user:${who(roleKey)}`;

  // Report windows. The book stretches back a year because last season's
  // renewal policy started then; the forward edge covers the policy the demo
  // issues two days after the seed clock.
  const yearBack = now - 365 * DAY;
  const monthBack = now - 30 * DAY;
  const monthAhead = now + 30 * DAY;

  const reportIds = {
    gwp: id("rep", now + 1),
    panel: id("rep", now + 2),
    commission: id("rep", now + 3),
    funnel: id("rep", now + 4),
    aiSpend: id("rep", now + 5),
    cases: id("rep", now + 6),
    book: id("rep", now + 7),
    txns: id("rep", now + 8)
  };
  const dashboardIds = {
    funnel: id("dsh", now + 11),
    finance: id("dsh", now + 12),
    service: id("dsh", now + 13),
    analystDesk: id("dsh", now + 14)
  };
  const runIds = {
    gwpNightly: id("run", now + 21),
    panel: id("run", now + 22),
    commission: id("run", now + 23),
    funnel: id("run", now + 24),
    aiSpendFailed: id("run", now + 25),
    casesRunning: id("run", now + 26),
    bookQueued: id("run", now + 27),
    txnsExpired: id("run", now + 28)
  };

  /* ------------------------------------------------------------- reports */
  // Eight saved questions, each inheriting its dataset's permission: a report is
  // never a way to relabel data as less sensitive than the table it reads, which
  // is why `requiredPermission` matches the dataset rather than the author.
  await db.insert(schema.reports).values([
    {
      id: reportIds.gwp,
      tenantId,
      key: "gwp.by-channel",
      module: "axis",
      nameJson: JSON.stringify({ en: "Gross written premium by channel", ar: "إجمالي الأقساط المكتتبة حسب القناة" }),
      descriptionJson: JSON.stringify({
        en: "What each channel wrote, and what the average policy was worth.",
        ar: "ما كتبته كل قناة ومتوسط قيمة الوثيقة."
      }),
      definitionJson: JSON.stringify({
        dataset: "policies",
        metrics: ["policies", "gwp", "avgPremium"],
        dimensions: ["channelId", "status"],
        from: yearBack,
        to: monthAhead,
        sort: { field: "gwp", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "axis:policies:read",
      ownerRef: null,
      scope: "tenant",
      // System reports ship with the tenant: the 7am schedule points at this one,
      // so it must not be something a user can delete out from under a delivery.
      system: true,
      createdAt: now - 30 * DAY,
      updatedAt: now - 30 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.panel,
      tenantId,
      key: "panel.response-by-provider",
      module: "dist",
      nameJson: JSON.stringify({ en: "Panel response by underwriter", ar: "استجابة اللجنة حسب شركة التأمين" }),
      descriptionJson: JSON.stringify({
        en: "Who answers, how fast, and at what price — the panel review in one table.",
        ar: "من يستجيب وبأي سرعة وبأي سعر — مراجعة اللجنة في جدول واحد."
      }),
      definitionJson: JSON.stringify({
        dataset: "quoteResponses",
        metrics: ["responses", "premium", "latency", "valueScore"],
        dimensions: ["providerId", "state"],
        from: monthBack,
        to: monthAhead,
        sort: { field: "responses", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "dist:quote_requests:read",
      ownerRef: null,
      scope: "tenant",
      system: true,
      createdAt: now - 30 * DAY,
      updatedAt: now - 12 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.commission,
      tenantId,
      key: "commission.earned",
      module: "dist",
      nameJson: JSON.stringify({ en: "Commission earned", ar: "العمولة المكتسبة" }),
      descriptionJson: JSON.stringify({
        en: "Gross, channel share and net by kind — the figures month-end recon starts from.",
        ar: "الإجمالي وحصة القناة والصافي حسب النوع — الأرقام التي تبدأ منها تسوية نهاية الشهر."
      }),
      definitionJson: JSON.stringify({
        dataset: "commissions",
        metrics: ["entries", "premium", "gross", "channel", "net"],
        dimensions: ["kind", "channelId", "state"],
        from: yearBack,
        to: monthAhead,
        sort: { field: "net", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "dist:commissions:read",
      ownerRef: null,
      scope: "tenant",
      system: true,
      createdAt: now - 30 * DAY,
      updatedAt: now - 30 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.funnel,
      tenantId,
      key: "quotes.daily-funnel",
      module: "dist",
      nameJson: JSON.stringify({ en: "Quote requests per day", ar: "طلبات التسعير يوميًا" }),
      descriptionJson: JSON.stringify({
        en: "Requests, responses received and the best price offered, by day.",
        ar: "الطلبات والردود الواردة وأفضل سعر معروض، يوميًا."
      }),
      definitionJson: JSON.stringify({
        dataset: "quotes",
        metrics: ["requests", "responded", "bestPremium"],
        grain: "day",
        from: monthBack,
        to: monthAhead
      }),
      piiLevel: "none",
      requiredPermission: "dist:quote_requests:read",
      ownerRef: null,
      scope: "tenant",
      system: false,
      createdAt: now - 20 * DAY,
      updatedAt: now - 20 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.aiSpend,
      tenantId,
      key: "ai.spend-by-purpose",
      module: "ai",
      nameJson: JSON.stringify({ en: "AI spend by purpose", ar: "إنفاق الذكاء الاصطناعي حسب الغرض" }),
      descriptionJson: JSON.stringify({
        en: "Calls, tokens and cost per purpose and model — the budget conversation.",
        ar: "المكالمات والرموز والتكلفة لكل غرض ونموذج — نقاش الميزانية."
      }),
      definitionJson: JSON.stringify({
        dataset: "aiSpend",
        metrics: ["calls", "tokensIn", "tokensOut", "costMicro", "latency"],
        dimensions: ["purpose", "model"],
        from: monthBack,
        to: monthAhead,
        sort: { field: "costMicro", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "ai:budgets:read",
      ownerRef: null,
      scope: "tenant",
      system: false,
      createdAt: now - 18 * DAY,
      updatedAt: now - 4 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.cases,
      tenantId,
      key: "cases.by-status",
      module: "axis",
      nameJson: JSON.stringify({ en: "Cases by status", ar: "الحالات حسب الوضع" }),
      descriptionJson: JSON.stringify({
        en: "Where the work is sitting, and what it is worth.",
        ar: "أين يقف العمل وما قيمته."
      }),
      definitionJson: JSON.stringify({
        dataset: "cases",
        metrics: ["cases", "value", "avgRisk", "customers"],
        dimensions: ["status", "productLine"],
        from: monthBack,
        to: monthAhead,
        sort: { field: "cases", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "axis:cases:read",
      ownerRef: null,
      scope: "tenant",
      system: false,
      createdAt: now - 15 * DAY,
      updatedAt: now - 15 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.book,
      tenantId,
      key: "book.premium-by-customer",
      module: "axis",
      nameJson: JSON.stringify({ en: "Premium by customer", ar: "القسط حسب العميل" }),
      descriptionJson: JSON.stringify({
        en: "Named book. The customer column is masked unless the reader may view PII.",
        ar: "سجل بالأسماء. عمود العميل مُخفى ما لم يكن للقارئ حق الاطلاع على البيانات الشخصية."
      }),
      definitionJson: JSON.stringify({
        dataset: "policies",
        metrics: ["policies", "gwp", "commission"],
        dimensions: ["customerId", "productId"],
        from: yearBack,
        to: monthAhead,
        sort: { field: "gwp", dir: "desc" },
        limit: 200
      }),
      // High: a dimension on a PII column. The report screen shows the banner and
      // the engine masks the column for anyone without `core:pii:view`.
      piiLevel: "high",
      requiredPermission: "axis:policies:read",
      // Personal scope, so this one is proof that the scope filter works: nobody
      // but the analyst who built it sees it in the list.
      ownerRef: ref("north.analyst"),
      scope: "personal",
      system: false,
      createdAt: now - 9 * DAY,
      updatedAt: now - 9 * DAY,
      deletedAt: null
    },
    {
      id: reportIds.txns,
      tenantId,
      key: "ledger.txns-by-state",
      module: "ledger",
      nameJson: JSON.stringify({ en: "Transactions by state", ar: "المعاملات حسب الحالة" }),
      descriptionJson: JSON.stringify({
        en: "What is pending, posted and reversed — the money view of the same week.",
        ar: "ما هو معلق ومُرحّل ومعكوس — العرض المالي لنفس الأسبوع."
      }),
      definitionJson: JSON.stringify({
        dataset: "transactions",
        metrics: ["txns", "gross"],
        dimensions: ["type", "state", "currency"],
        from: monthBack,
        to: monthAhead,
        sort: { field: "gross", dir: "desc" }
      }),
      piiLevel: "none",
      requiredPermission: "ledger:txns:read",
      ownerRef: null,
      scope: "tenant",
      system: false,
      createdAt: now - 11 * DAY,
      updatedAt: now - 11 * DAY,
      deletedAt: null
    }
  ]);

  /* ---------------------------------------------------------- dashboards */
  // Tiles carry their definition inline rather than pointing at a report, so a
  // dashboard survives someone deleting a report out from under it.
  //
  // ponytail: tile keys are the heading the screen paints. The dashboard route
  // falls back to the raw key when `common.<key>` is missing, and no metric
  // labels exist in the shared catalogue yet — so these read as English rather
  // than as dotted keys. Move them to `common.*` when that catalogue grows.
  await db.insert(schema.dashboards).values([
    {
      id: dashboardIds.funnel,
      tenantId,
      key: "dist.funnel",
      module: "dist",
      nameJson: JSON.stringify({ en: "Distribution funnel", ar: "مسار التوزيع" }),
      layoutJson: JSON.stringify({
        tiles: [
          {
            key: "Quote requests",
            viz: "number",
            span: 3,
            definition: { dataset: "quotes", metrics: ["requests", "responded"], from: monthBack, to: monthAhead }
          },
          {
            key: "Requests by day",
            viz: "line",
            span: 9,
            definition: { dataset: "quotes", metrics: ["requests"], grain: "day", from: monthBack, to: monthAhead }
          },
          {
            key: "Panel responses by underwriter",
            viz: "bar",
            span: 6,
            definition: {
              dataset: "quoteResponses",
              metrics: ["responses"],
              dimensions: ["providerId"],
              from: monthBack,
              to: monthAhead,
              sort: { field: "responses", dir: "desc" },
              limit: 8
            }
          },
          {
            key: "Offers by price rank",
            viz: "table",
            span: 6,
            definition: {
              dataset: "quoteResponses",
              metrics: ["premium", "latency", "valueScore"],
              dimensions: ["priceRank"],
              from: monthBack,
              to: monthAhead,
              sort: { field: "priceRank", dir: "asc" }
            }
          }
        ]
      }),
      scope: "tenant",
      ownerRef: null,
      // No role list: the funnel is the tenant's default board, and the dataset's
      // own permission still gates every tile on it.
      rolesJson: null,
      isDefault: true,
      createdAt: now - 30 * DAY,
      updatedAt: now - 30 * DAY
    },
    {
      id: dashboardIds.finance,
      tenantId,
      key: "finance.commission",
      module: "ledger",
      nameJson: JSON.stringify({ en: "Commission and premium", ar: "العمولة والأقساط" }),
      layoutJson: JSON.stringify({
        tiles: [
          {
            key: "Commission earned",
            viz: "number",
            span: 4,
            definition: { dataset: "commissions", metrics: ["gross", "net", "entries"], from: yearBack, to: monthAhead }
          },
          {
            key: "Net commission by channel",
            viz: "donut",
            span: 4,
            definition: {
              dataset: "commissions",
              metrics: ["net"],
              dimensions: ["channelId"],
              from: yearBack,
              to: monthAhead
            }
          },
          {
            key: "Premium written by month",
            viz: "bar",
            span: 4,
            definition: { dataset: "policies", metrics: ["gwp"], grain: "month", from: yearBack, to: monthAhead }
          },
          {
            // Reads the ledger rather than the commission register, so the two
            // can be compared before month-end recon rather than after it.
            key: "Transactions by type and state",
            viz: "table",
            span: 12,
            definition: {
              dataset: "transactions",
              metrics: ["txns", "gross"],
              dimensions: ["type", "state"],
              from: monthBack,
              to: monthAhead
            }
          }
        ]
      }),
      scope: "tenant",
      ownerRef: null,
      rolesJson: JSON.stringify(["finance.controller", "finance.analyst", "north.exec", "tenant.admin"]),
      isDefault: false,
      createdAt: now - 28 * DAY,
      updatedAt: now - 6 * DAY
    },
    {
      id: dashboardIds.service,
      tenantId,
      key: "orbit.service",
      module: "orbit",
      nameJson: JSON.stringify({ en: "Service load", ar: "حِمل الخدمة" }),
      layoutJson: JSON.stringify({
        tiles: [
          {
            key: "Cases opened",
            viz: "number",
            span: 3,
            definition: { dataset: "cases", metrics: ["cases", "customers"], from: monthBack, to: monthAhead }
          },
          {
            key: "Cases by status",
            viz: "donut",
            span: 4,
            definition: { dataset: "cases", metrics: ["cases"], dimensions: ["status"], from: monthBack, to: monthAhead }
          },
          {
            key: "Conversations by channel",
            viz: "bar",
            span: 5,
            definition: {
              dataset: "conversations",
              metrics: ["conversations"],
              dimensions: ["channel"],
              from: monthBack,
              to: monthAhead
            }
          },
          {
            key: "Case load by product line",
            viz: "table",
            span: 12,
            definition: {
              dataset: "cases",
              metrics: ["cases", "value", "avgRisk"],
              dimensions: ["productLine", "kind"],
              from: monthBack,
              to: monthAhead
            }
          }
        ]
      }),
      scope: "tenant",
      ownerRef: null,
      rolesJson: JSON.stringify(["orbit.agent", "orbit.retention", "axis.lead", "tenant.admin"]),
      isDefault: false,
      createdAt: now - 25 * DAY,
      updatedAt: now - 25 * DAY
    },
    {
      id: dashboardIds.analystDesk,
      tenantId,
      key: "analyst.desk",
      module: "north",
      nameJson: JSON.stringify({ en: "My desk", ar: "مكتبي" }),
      layoutJson: JSON.stringify({
        tiles: [
          {
            key: "AI cost by purpose",
            viz: "bar",
            span: 6,
            definition: {
              dataset: "aiSpend",
              metrics: ["costMicro"],
              dimensions: ["purpose"],
              from: monthBack,
              to: monthAhead,
              sort: { field: "costMicro", dir: "desc" },
              limit: 8
            }
          },
          {
            key: "Best premium by day",
            viz: "line",
            span: 6,
            definition: { dataset: "quotes", metrics: ["bestPremium"], grain: "day", from: monthBack, to: monthAhead }
          }
        ]
      }),
      // Personal scope, so the visibility rule has something to hide: this board
      // is invisible to everyone but the analyst who owns it.
      scope: "personal",
      ownerRef: ref("north.analyst"),
      rolesJson: null,
      isDefault: false,
      createdAt: now - 5 * DAY,
      updatedAt: now - 5 * DAY
    }
  ]);

  /* --------------------------------------------------------- report runs */
  // A report nobody can prove ran is a rumour, so the register carries every
  // outcome the runner can produce: delivered, ad-hoc, failed, in flight, queued
  // and swept.
  await db.insert(schema.reportRuns).values([
    {
      id: runIds.gwpNightly,
      tenantId,
      reportId: reportIds.gwp,
      paramsJson: JSON.stringify({
        dataset: "policies",
        metrics: ["policies", "gwp", "avgPremium"],
        dimensions: ["channelId", "status"],
        from: yearBack,
        to: monthAhead
      }),
      // The scheduler is not a person. Schedule-triggered runs are requested by
      // the system actor that ran the tick.
      requestedBy: "system:scheduler",
      trigger: "schedule",
      state: "done",
      rowCount: 4,
      resultRef: null,
      truncated: false,
      durationMs: 412,
      error: null,
      expiresAt: now - 21 * HOUR + 24 * HOUR,
      startedAt: now - 21 * HOUR,
      endedAt: now - 21 * HOUR + 412
    },
    {
      id: runIds.panel,
      tenantId,
      reportId: reportIds.panel,
      paramsJson: JSON.stringify({
        dataset: "quoteResponses",
        metrics: ["responses", "premium", "latency", "valueScore"],
        dimensions: ["providerId", "state"],
        from: monthBack,
        to: monthAhead
      }),
      requestedBy: ref("north.analyst"),
      trigger: "user",
      // Four rows because four underwriters answered Rania's request.
      state: "done",
      rowCount: 4,
      resultRef: null,
      truncated: false,
      durationMs: 138,
      error: null,
      expiresAt: now - 3 * HOUR + 24 * HOUR,
      startedAt: now - 3 * HOUR,
      endedAt: now - 3 * HOUR + 138
    },
    {
      id: runIds.commission,
      tenantId,
      reportId: reportIds.commission,
      paramsJson: JSON.stringify({
        dataset: "commissions",
        metrics: ["entries", "premium", "gross", "channel", "net"],
        dimensions: ["kind", "channelId", "state"],
        from: yearBack,
        to: monthAhead
      }),
      requestedBy: ref("finance.controller"),
      // Pulled by the finance team's own tooling through the API rather than
      // from the screen, which is why the trigger is not `user`.
      trigger: "api",
      state: "done",
      rowCount: 1,
      resultRef: null,
      truncated: false,
      durationMs: 96,
      error: null,
      expiresAt: now - 2 * HOUR + 24 * HOUR,
      startedAt: now - 2 * HOUR,
      endedAt: now - 2 * HOUR + 96
    },
    {
      id: runIds.funnel,
      tenantId,
      reportId: reportIds.funnel,
      paramsJson: JSON.stringify({
        dataset: "quotes",
        metrics: ["requests", "responded", "bestPremium"],
        grain: "day",
        from: monthBack,
        to: monthAhead
      }),
      requestedBy: ref("signal.lead"),
      trigger: "user",
      state: "done",
      rowCount: 1,
      resultRef: null,
      truncated: false,
      durationMs: 74,
      error: null,
      expiresAt: now - 40 * MINUTE + 24 * HOUR,
      startedAt: now - 40 * MINUTE,
      endedAt: now - 40 * MINUTE + 74
    },
    {
      id: runIds.aiSpendFailed,
      tenantId,
      reportId: reportIds.aiSpend,
      // The definition asked for a dimension the semantic layer does not declare.
      // The engine refuses rather than guessing a column, and the refusal is kept
      // so the analyst can see what they asked for.
      paramsJson: JSON.stringify({
        dataset: "aiSpend",
        metrics: ["calls", "costMicro"],
        dimensions: ["agentRef"],
        from: monthBack,
        to: monthAhead
      }),
      requestedBy: ref("north.analyst"),
      trigger: "user",
      state: "failed",
      rowCount: null,
      resultRef: null,
      truncated: false,
      durationMs: 11,
      error: "unknown dimension agentRef on aiSpend",
      expiresAt: now - 4 * DAY + 24 * HOUR,
      startedAt: now - 4 * DAY,
      endedAt: now - 4 * DAY + 11
    },
    {
      id: runIds.casesRunning,
      tenantId,
      reportId: reportIds.cases,
      paramsJson: JSON.stringify({
        dataset: "cases",
        metrics: ["cases", "value", "avgRisk", "customers"],
        dimensions: ["status", "productLine"],
        from: monthBack,
        to: monthAhead
      }),
      requestedBy: ref("axis.agent"),
      trigger: "user",
      // In flight as the seed clock stops: no end, no row count yet.
      state: "running",
      rowCount: null,
      resultRef: null,
      truncated: false,
      durationMs: null,
      error: null,
      expiresAt: now + 24 * HOUR,
      startedAt: now - 20_000,
      endedAt: null
    },
    {
      id: runIds.bookQueued,
      tenantId,
      reportId: reportIds.book,
      paramsJson: JSON.stringify({
        dataset: "policies",
        metrics: ["policies", "gwp", "commission"],
        dimensions: ["customerId", "productId"],
        from: yearBack,
        to: monthAhead,
        limit: 200
      }),
      requestedBy: ref("north.analyst"),
      trigger: "user",
      state: "queued",
      rowCount: null,
      resultRef: null,
      truncated: false,
      durationMs: null,
      error: null,
      expiresAt: now + 24 * HOUR,
      startedAt: now - 4_000,
      endedAt: null
    },
    {
      id: runIds.txnsExpired,
      tenantId,
      reportId: reportIds.txns,
      paramsJson: JSON.stringify({
        dataset: "transactions",
        metrics: ["txns", "gross"],
        dimensions: ["type", "state", "currency"],
        from: monthBack,
        to: monthAhead
      }),
      requestedBy: ref("finance.analyst"),
      trigger: "user",
      // Results live 24 hours. This one ran two days ago, so the row survives as
      // the record that it ran while the payload is gone.
      state: "expired",
      rowCount: 3,
      resultRef: null,
      truncated: false,
      durationMs: 88,
      error: null,
      expiresAt: now - 2 * DAY + 24 * HOUR,
      startedAt: now - 2 * DAY,
      endedAt: now - 2 * DAY + 88
    }
  ]);

  /* ------------------------------------------------------------- exports */
  // No `fileId` anywhere below: nothing has rendered bytes into R2 in a fresh
  // install, and a file id pointing at a missing object fails on the first
  // download. The register is the record of what was asked for and who approved
  // it; the demo produces real artefacts the moment someone exports a report.
  await db.insert(schema.analyticsExports).values([
    {
      id: id("exp", now + 31),
      tenantId,
      runId: runIds.gwpNightly,
      reportId: reportIds.gwp,
      subjectRef: null,
      format: "pdf",
      fileId: null,
      sizeBytes: 48_210,
      rowCount: 4,
      piiMasked: true,
      piiJustification: null,
      watermark: `system:scheduler · ${new Date(now - 21 * HOUR).toISOString().slice(0, 19)}`,
      requestedBy: "system:scheduler",
      approvedBy: null,
      state: "ready",
      downloadCount: 2,
      expiresAt: now - 21 * HOUR + 7 * DAY,
      error: null,
      createdAt: now - 21 * HOUR,
      updatedAt: now - 20 * HOUR
    },
    {
      id: id("exp", now + 32),
      tenantId,
      runId: runIds.commission,
      reportId: reportIds.commission,
      subjectRef: null,
      format: "xlsx",
      fileId: null,
      sizeBytes: 12_884,
      rowCount: 1,
      piiMasked: true,
      piiJustification: null,
      watermark: `${ref("finance.controller")} · ${new Date(now - 2 * HOUR).toISOString().slice(0, 19)}`,
      requestedBy: ref("finance.controller"),
      approvedBy: null,
      state: "ready",
      downloadCount: 1,
      expiresAt: now - 2 * HOUR + 7 * DAY,
      error: null,
      createdAt: now - 2 * HOUR,
      updatedAt: now - 2 * HOUR
    },
    {
      id: id("exp", now + 33),
      tenantId,
      runId: null,
      reportId: reportIds.book,
      subjectRef: null,
      format: "xlsx",
      fileId: null,
      sizeBytes: null,
      rowCount: null,
      // Unmasked, so it carries a justification, a second name and a watermark.
      // Dual control is the whole point: the analyst asked, the compliance
      // officer agreed, and the artefact says both.
      piiMasked: false,
      piiJustification: `Regulator sample request REG-2026-014: named policyholders for the ${monthName(now)} motor book.`,
      watermark: `${ref("north.analyst")} · ${new Date(now - 30 * MINUTE).toISOString().slice(0, 19)}`,
      requestedBy: ref("north.analyst"),
      approvedBy: ref("tenant.compliance"),
      state: "rendering",
      downloadCount: 0,
      expiresAt: now - 30 * MINUTE + 7 * DAY,
      error: null,
      createdAt: now - 30 * MINUTE,
      updatedAt: now - 29 * MINUTE
    },
    {
      id: id("exp", now + 34),
      tenantId,
      runId: runIds.casesRunning,
      reportId: reportIds.cases,
      subjectRef: null,
      format: "csv",
      fileId: null,
      sizeBytes: null,
      rowCount: null,
      piiMasked: true,
      piiJustification: null,
      watermark: null,
      requestedBy: ref("axis.agent"),
      approvedBy: null,
      // Queued behind its own run: the export was asked for while the report was
      // still materialising.
      state: "queued",
      downloadCount: 0,
      expiresAt: now + 7 * DAY,
      error: null,
      createdAt: now - 15_000,
      updatedAt: now - 15_000
    },
    {
      id: id("exp", now + 35),
      tenantId,
      runId: runIds.aiSpendFailed,
      reportId: reportIds.aiSpend,
      subjectRef: null,
      format: "pdf",
      fileId: null,
      sizeBytes: null,
      rowCount: null,
      piiMasked: true,
      piiJustification: null,
      watermark: null,
      requestedBy: ref("north.analyst"),
      approvedBy: null,
      state: "failed",
      downloadCount: 0,
      expiresAt: now - 4 * DAY + 7 * DAY,
      error: "unknown dimension agentRef on aiSpend",
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      id: id("exp", now + 36),
      tenantId,
      runId: null,
      // Not a report at all: a case pack, which is why it names a subject
      // instead. The register covers every artefact, not only report output.
      reportId: null,
      subjectRef: `axis_case:${ctx.caseId}`,
      format: "pdf",
      fileId: null,
      sizeBytes: 96_400,
      rowCount: null,
      piiMasked: true,
      piiJustification: null,
      watermark: `${ref("axis.lead")} · ${new Date(now - 9 * DAY).toISOString().slice(0, 19)}`,
      requestedBy: ref("axis.lead"),
      approvedBy: null,
      // Artefacts live seven days. This one is past that, so it stays as the
      // audit trail while the file is gone.
      state: "expired",
      downloadCount: 3,
      expiresAt: now - 2 * DAY,
      error: null,
      createdAt: now - 9 * DAY,
      updatedAt: now - 2 * DAY
    }
  ]);

  /* ----------------------------------------------------------- schedules */
  await db.insert(schema.analyticsSchedules).values([
    {
      id: id("sch", now + 41),
      tenantId,
      reportId: reportIds.gwp,
      dashboardId: null,
      nameJson: JSON.stringify({ en: "Executive 7am read", ar: "قراءة السابعة صباحًا للإدارة" }),
      cron: "0 7 * * *",
      timezone: "Asia/Dubai",
      format: "pdf",
      recipientsJson: JSON.stringify([who("north.exec"), who("tenant.admin")]),
      paramsJson: null,
      locale: "en",
      status: "active",
      lastRunAt: now - 21 * HOUR,
      lastState: "done",
      nextRunAt: nextAt(now, 3 * HOUR),
      createdBy: ref("north.analyst"),
      createdAt: now - 30 * DAY,
      updatedAt: now - 21 * HOUR
    },
    {
      id: id("sch", now + 42),
      tenantId,
      reportId: reportIds.panel,
      dashboardId: null,
      nameJson: JSON.stringify({ en: "Monday panel pack", ar: "حزمة اللجنة يوم الاثنين" }),
      cron: "0 8 * * 1",
      timezone: "Asia/Dubai",
      format: "xlsx",
      recipientsJson: JSON.stringify([who("axis.lead"), who("north.analyst")]),
      paramsJson: JSON.stringify({ grain: "week" }),
      locale: "en",
      status: "active",
      lastRunAt: now - 5 * DAY,
      lastState: "done",
      // The next Monday slot on the demo clock; the API expands the cron for real.
      nextRunAt: nextAt(now + 5 * DAY, 4 * HOUR),
      createdBy: ref("axis.lead"),
      createdAt: now - 26 * DAY,
      updatedAt: now - 5 * DAY
    },
    {
      id: id("sch", now + 43),
      tenantId,
      reportId: reportIds.commission,
      dashboardId: null,
      nameJson: JSON.stringify({ en: "Month-end commission file", ar: "ملف العمولات لنهاية الشهر" }),
      cron: "0 6 1 * *",
      timezone: "Asia/Dubai",
      format: "csv",
      recipientsJson: JSON.stringify([who("finance.controller"), who("finance.analyst")]),
      paramsJson: null,
      locale: "en",
      status: "active",
      lastRunAt: now - 12 * DAY,
      // Partial: one named recipient no longer holds `dist:commissions:read`, so
      // the artefact rendered but did not reach everyone on the list.
      lastState: "partial",
      nextRunAt: nextAt(now + 18 * DAY, 2 * HOUR),
      createdBy: ref("finance.controller"),
      createdAt: now - 60 * DAY,
      updatedAt: now - 12 * DAY
    },
    {
      id: id("sch", now + 44),
      tenantId,
      reportId: null,
      dashboardId: dashboardIds.funnel,
      nameJson: JSON.stringify({ en: "Daily funnel board", ar: "لوحة المسار اليومية" }),
      cron: "0 7 * * 1-5",
      timezone: "Asia/Dubai",
      format: "pdf",
      recipientsJson: JSON.stringify([who("signal.lead")]),
      paramsJson: null,
      locale: "en",
      // Paused, and it has to stay paused: delivery renders reports, not
      // dashboards, so an active dashboard schedule would fail on every tick.
      // The `failed` last state is the run that taught the team that.
      status: "paused",
      lastRunAt: now - 3 * DAY,
      lastState: "failed",
      nextRunAt: null,
      createdBy: ref("signal.lead"),
      createdAt: now - 8 * DAY,
      updatedAt: now - 3 * DAY
    },
    {
      id: id("sch", now + 45),
      tenantId,
      reportId: reportIds.aiSpend,
      dashboardId: null,
      nameJson: JSON.stringify({ en: "Daily AI spend digest", ar: "ملخص إنفاق الذكاء الاصطناعي اليومي" }),
      cron: "30 5 * * *",
      timezone: "Asia/Dubai",
      format: "csv",
      // Deliberately an email address rather than a user id: the delivery step
      // resolves either, and drops anyone it cannot match to an active user.
      recipientsJson: JSON.stringify(["finance@gonxt.ae"]),
      paramsJson: null,
      locale: "en",
      status: "active",
      lastRunAt: now - 26 * HOUR,
      // Undelivered: the address matched nobody in this tenant, so the file
      // rendered and reached no inbox.
      lastState: "undelivered",
      nextRunAt: nextAt(now, HOUR + 30 * MINUTE),
      createdBy: ref("tenant.admin"),
      createdAt: now - 14 * DAY,
      updatedAt: now - 26 * HOUR
    }
  ]);

  /* --------------------------------------------------------- saved views */
  // A saved view with no `userId` is the tenant's; one with a `userId` is that
  // person's and nobody else's, which is what the last two rows are here for.
  await db.insert(schema.savedViews).values([
    {
      id: id("sv", now + 51),
      tenantId,
      userId: null,
      route: "/axis/cases",
      name: "Motor binds in flight",
      queryJson: JSON.stringify({ kind: "bind", productLine: "motor", status: "in_progress" }),
      columnsJson: JSON.stringify(["reference", "status", "ownerRef", "valueMinor", "updatedAt"]),
      isDefault: true,
      sharedWithJson: null,
      createdAt: now - 24 * DAY,
      updatedAt: now - 24 * DAY
    },
    {
      id: id("sv", now + 52),
      tenantId,
      userId: null,
      route: "/distribution/quote-requests",
      name: "Panels still waiting on an underwriter",
      queryJson: JSON.stringify({ state: "fanned_out" }),
      columnsJson: JSON.stringify(["reference", "state", "fanoutCount", "respondedCount", "createdAt"]),
      isDefault: false,
      sharedWithJson: null,
      createdAt: now - 22 * DAY,
      updatedAt: now - 22 * DAY
    },
    {
      id: id("sv", now + 53),
      tenantId,
      userId: null,
      route: "/analytics/report-runs",
      name: "Runs that failed",
      queryJson: JSON.stringify({ state: "failed" }),
      columnsJson: JSON.stringify(["reportId", "trigger", "state", "error", "startedAt"]),
      isDefault: false,
      sharedWithJson: null,
      createdAt: now - 7 * DAY,
      updatedAt: now - 7 * DAY
    },
    {
      id: id("sv", now + 54),
      tenantId,
      userId: null,
      route: "/analytics/exports",
      name: "Unmasked artefacts",
      queryJson: JSON.stringify({ piiMasked: false }),
      columnsJson: JSON.stringify(["reportId", "format", "state", "requestedBy", "approvedBy", "createdAt"]),
      isDefault: false,
      // Named rather than tenant-wide: compliance and the controller watch this
      // list, and it is on the shared route so the two of them see the same one.
      sharedWithJson: JSON.stringify([who("tenant.compliance"), who("finance.controller")]),
      createdAt: now - 6 * DAY,
      updatedAt: now - 6 * DAY
    },
    {
      id: id("sv", now + 55),
      tenantId,
      // Private to the controller: their own reconciliation queue, invisible to
      // everyone else on the same screen.
      userId: who("finance.controller"),
      route: "/ledger/txns",
      name: "My reconciliation queue",
      queryJson: JSON.stringify({ state: "pending", type: "commission" }),
      columnsJson: JSON.stringify(["reference", "type", "state", "grossMinor", "createdAt"]),
      isDefault: true,
      sharedWithJson: null,
      createdAt: now - 4 * DAY,
      updatedAt: now - 4 * DAY
    },
    {
      id: id("sv", now + 56),
      tenantId,
      userId: who("orbit.retention"),
      route: "/orbit/renewals",
      name: "My 30-day window",
      queryJson: JSON.stringify({ status: "raised", withinDays: 30 }),
      columnsJson: JSON.stringify(["policyId", "status", "dueAt", "assigneeRef"]),
      isDefault: false,
      sharedWithJson: null,
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY
    }
  ]);

  /* ---------------------------------------------------- unit economics */
  // Cost per outcome (NFR-013). The bind row is the one that has to tie out: the
  // Cedar motor policy is 412,500 minor AED of premium at 12.5% base commission,
  // which the core seed books as 51,563 minor gross with no channel share on a
  // b2c web sale and no tax, so 51,563 net. Revenue is booked once, on the bind —
  // the case, conversation and renewal rows carry the cost of the same work, and
  // double-counting the commission across them would flatter every one of them.
  await db.insert(schema.unitEconomics).values([
    {
      id: id("uec", now + 61),
      tenantId,
      day: day(ctx.issuedAt),
      module: "dist",
      unit: "bind",
      volume: 1,
      // Rating the panel, ranking the offers and drafting the comparison note.
      aiCostMicro: 41_200,
      mediaCostMicro: 0,
      humanMinutes: 12,
      revenueMinor: 51_563,
      currency: "AED",
      updatedAt: ctx.issuedAt + HOUR
    },
    {
      id: id("uec", now + 62),
      tenantId,
      day: day(now - DAY),
      module: "axis",
      unit: "case",
      volume: 9,
      aiCostMicro: 214_000,
      mediaCostMicro: 0,
      humanMinutes: 143,
      // Casework earns nothing by itself; the money lands on the bind above.
      revenueMinor: 0,
      currency: "AED",
      updatedAt: now - DAY + 23 * HOUR
    },
    {
      id: id("uec", now + 63),
      tenantId,
      day: day(now - DAY),
      module: "orbit",
      unit: "conversation",
      volume: 34,
      aiCostMicro: 612_000,
      mediaCostMicro: 0,
      humanMinutes: 96,
      revenueMinor: 0,
      currency: "AED",
      updatedAt: now - DAY + 23 * HOUR
    },
    {
      id: id("uec", now + 64),
      tenantId,
      day: day(now - DAY),
      module: "orbit",
      unit: "renewal",
      volume: 7,
      aiCostMicro: 158_000,
      mediaCostMicro: 0,
      humanMinutes: 21,
      // Renewals raised, none accepted yet, so nothing has been earned on them.
      revenueMinor: 0,
      currency: "AED",
      updatedAt: now - DAY + 23 * HOUR
    },
    {
      id: id("uec", now + 65),
      tenantId,
      day: day(now - 2 * DAY),
      module: "signal",
      unit: "campaign",
      volume: 1,
      aiCostMicro: 96_000,
      // 1,250 AED of media, in micro-units of the major unit: the register divides
      // by 10,000 to get minor units, so this reads as 125,000 fils.
      mediaCostMicro: 1_250_000_000,
      humanMinutes: 34,
      revenueMinor: 0,
      currency: "AED",
      updatedAt: now - 2 * DAY + 23 * HOUR
    },
    {
      id: id("uec", now + 66),
      tenantId,
      day: day(now - 2 * DAY),
      module: "north",
      unit: "brief",
      volume: 2,
      aiCostMicro: 380_000,
      mediaCostMicro: 0,
      humanMinutes: 15,
      revenueMinor: 0,
      currency: "AED",
      updatedAt: now - 2 * DAY + 23 * HOUR
    }
  ]);

  /* -------------------------------------------------------- journey events */
  // J-C1, "get covered on the web", traced through the journey the rest of the
  // seed tells: Rania lands on the b2c site, asks for motor cover, four
  // underwriters answer, she takes Cedar, pays, and is offered home cover on the
  // way out. Two other sessions from the same week drop out — one before it
  // submits anything, one at the payment step — because a funnel with no
  // drop-off is a straight line and says nothing.
  const landed = now - 4 * MINUTE;
  const abandonedAt = now - 3 * HOUR;
  const declinedAt = now - 90 * MINUTE;
  await db.insert(schema.journeyEvents).values([
    {
      id: id("jev", now + 71),
      tenantId,
      journeyId: "J-C1",
      step: "landed",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `dist_channel:${ctx.channels.web}`,
      outcome: "progressed",
      durationMs: null,
      ts: landed
    },
    {
      id: id("jev", now + 72),
      tenantId,
      journeyId: "J-C1",
      step: "quote_requested",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `dist_quote_request:${ctx.quoteRequestId}`,
      outcome: "progressed",
      // Four minutes from landing to a three-field quick quote.
      durationMs: now - landed,
      ts: now
    },
    {
      id: id("jev", now + 73),
      tenantId,
      journeyId: "J-C1",
      step: "offers_ranked",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `dist_quote_request:${ctx.quoteRequestId}`,
      outcome: "progressed",
      // The panel was shared with her forty seconds after she asked.
      durationMs: 40_000,
      ts: now + 40_000
    },
    {
      id: id("jev", now + 74),
      tenantId,
      journeyId: "J-C1",
      step: "offer_chosen",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `dist_offering:${ctx.offerings.cedarMotor}`,
      outcome: "progressed",
      durationMs: 110_000,
      ts: now + 150_000
    },
    {
      id: id("jev", now + 75),
      tenantId,
      journeyId: "J-C1",
      step: "documents_uploaded",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `axis_case:${ctx.caseId}`,
      outcome: "progressed",
      durationMs: 5 * MINUTE,
      ts: now + 8 * MINUTE
    },
    {
      id: id("jev", now + 76),
      tenantId,
      journeyId: "J-C1",
      step: "payment_authorised",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `axis_case:${ctx.caseId}`,
      outcome: "progressed",
      durationMs: 70_000,
      // Nine minutes after landing, inside the ten-minute target for J-C1.
      ts: now + 9 * MINUTE
    },
    {
      id: id("jev", now + 77),
      tenantId,
      journeyId: "J-C1",
      step: "policy_issued",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `axis_policy:${ctx.policyId}`,
      outcome: "completed",
      // The seed issues the policy two days after the quote, so the journey's
      // end-to-end duration is measured to the cover starting, not to payment.
      durationMs: ctx.issuedAt - landed,
      ts: ctx.issuedAt
    },
    {
      id: id("jev", now + 78),
      tenantId,
      journeyId: "J-C1",
      step: "cross_sell_offered",
      actorRef: `customer:${ctx.customerId}`,
      subjectRef: `dist_offering:${ctx.offerings.cedarHome}`,
      // Offered, not taken: the next-best-offer row is still proposed.
      outcome: "progressed",
      durationMs: null,
      ts: ctx.issuedAt + 2 * MINUTE
    },
    {
      id: id("jev", now + 79),
      tenantId,
      journeyId: "J-C1",
      step: "landed",
      actorRef: "session:gnx-web-4471",
      subjectRef: `dist_channel:${ctx.channels.web}`,
      outcome: "progressed",
      durationMs: null,
      ts: abandonedAt
    },
    {
      id: id("jev", now + 80),
      tenantId,
      journeyId: "J-C1",
      step: "quote_requested",
      actorRef: "session:gnx-web-4471",
      subjectRef: null,
      // Left on the vehicle-details step, so no quote request was ever created.
      outcome: "abandoned",
      durationMs: 70_000,
      ts: abandonedAt + 70_000
    },
    {
      id: id("jev", now + 81),
      tenantId,
      journeyId: "J-C1",
      step: "offers_ranked",
      actorRef: "session:gnx-web-5290",
      subjectRef: null,
      outcome: "progressed",
      durationMs: 52_000,
      ts: declinedAt
    },
    {
      id: id("jev", now + 82),
      tenantId,
      journeyId: "J-C1",
      step: "payment_authorised",
      actorRef: "session:gnx-web-5290",
      subjectRef: null,
      // The card was declined at the payment provider — a failure of the step,
      // not a customer walking away, and the funnel should not confuse the two.
      outcome: "failed",
      durationMs: 145_000,
      ts: declinedAt + 145_000
    }
  ]);
}
