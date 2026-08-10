import type React from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  ApprovalStrip,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  Eyebrow,
  hueVar,
  KPIWall,
  Money,
  shortRef,
  Sparkline,
  Stat,
  Timeline,
  type BadgeTone,
  type TimelineEvent
} from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { DEFAULT_LOCALE, pseudoText, translator } from "../i18n";
import { humanise } from "../modules/spec";
import { labelKeyFor, moduleOf } from "../routing";
import { useShellData } from "./workspace";

// The landing screen for an actor whose roles point at no particular workspace.
// It answers three questions in one paint — what is waiting on me, how is the
// business doing, where do I go — and answers none of them by guessing: every
// panel here is a permission the actor actually holds.
//
// Every panel is fed by an endpoint that exists in apps/api:
//   GET  /v1/me/inbox                    approvals + unread notifications
//   POST /v1/me/approvals/:id/decide     the decision
//   POST /v1/me/notifications/:id/read   clearing one
//   GET  /v1/analytics/unit-economics    the KPIs and the per-area summary
//   GET  /v1/core/audit-log              this actor's own recent activity
//   GET  /v1/ai/runs                     what the agents have been doing

/* ------------------------------------------------------------------ labels */

/**
 * Local, because en.ts/ar.ts are the shell's shared vocabulary and a screen that
 * only exists once has no business growing them. Generic words (nav labels,
 * "Search") still come from the shared catalogue via `translator`.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    greeting: "Welcome back, {name}",
    "greeting.anon": "Welcome back",
    subtitle: "What is waiting for you in {brand}.",

    // The one sentence the screen opens with — Horizon answers rather than
    // displays. It is deliberately count-free: the numbers are one row below on
    // the KPI wall, and a sentence carrying a count needs a plural rule per
    // locale to stay grammatical (Arabic has five).
    "answer.decisions": "There is work waiting on your decision.",
    "answer.unread": "Nothing needs your decision; there is news to read.",
    "answer.clear": "Nothing is waiting on you.",
    "answer.unknown": "Your inbox did not load. Everything else on this page did.",

    "kpi.approvals": "Waiting on you",
    "kpi.notifications": "Unread",
    "kpi.revenue": "Revenue, 30 days",
    "kpi.revenue.hint": "Change is margin after AI and media cost",
    "kpi.volume": "Units delivered",
    "kpi.volume.trend": "Units delivered per day over the last 30 days",

    "approvals.title": "Decisions waiting on you",
    "approvals.subject": "Subject {ref}",
    "approvals.more": "{count} more waiting elsewhere",
    "approvals.all": "Open the full queue",
    "approvals.deciding": "Recording your decision…",
    "approvals.empty": "No decision is waiting on you right now.",
    "approvals.failed": "That decision was not recorded, and nothing changed.",

    "notifications.title": "Notifications",
    "notifications.label": "Unread notifications",
    "notifications.dismiss": "Mark as read",
    "notifications.dismissing": "Marking…",
    "notifications.empty": "Nothing unread.",
    "notice.analytics.schedule.delivered": "A scheduled report was delivered",
    "notice.analytics.schedule.undelivered": "A scheduled report reached only some recipients",
    "notice.analytics.schedule.failed": "A scheduled report could not be produced",

    "activity.title": "Your recent activity",
    "activity.label": "Your recent activity",
    "activity.empty": "You have not changed anything yet.",

    "runs.title": "Recent agent work",
    "runs.label": "Recent agent runs",
    "runs.empty": "No agent has run yet.",
    "runs.console": "Agent console",
    "runs.state.running": "Running",
    "runs.state.awaiting_approval": "Awaiting approval",
    "runs.state.succeeded": "Finished",
    "runs.state.refused": "Refused",
    "runs.state.failed": "Failed",
    "runs.state.cancelled": "Cancelled",
    "runs.state.budget_stopped": "Stopped on budget",

    "areas.title": "Where the work is",
    "areas.label": "Delivery by area over the last 30 days",
    "areas.units": "{count} delivered",
    "areas.empty": "Nothing has been measured in this window yet.",

    "links.title": "Your workspaces",
    "links.label": "Workspaces",

    "panel.failed": "This did not load. Nothing is wrong with your work — try again in a moment.",
    "panel.retry": "Reload",

    "empty.title": "Nothing is waiting",
    "empty.body": "No decisions, no unread notifications. Open a workspace to pick up work.",
    "empty.action": "Open a workspace"
  },
  ar: {
    greeting: "أهلًا بعودتك، {name}",
    "greeting.anon": "أهلًا بعودتك",
    subtitle: "ما ينتظرك في {brand}.",

    "answer.decisions": "هناك عمل بانتظار قرارك.",
    "answer.unread": "لا شيء يحتاج قرارك؛ هناك إشعارات غير مقروءة.",
    "answer.clear": "لا شيء ينتظرك الآن.",
    "answer.unknown": "تعذّر تحميل صندوق الوارد. بقية هذه الصفحة حُمّلت.",

    "kpi.approvals": "بانتظار قرارك",
    "kpi.notifications": "غير مقروء",
    "kpi.revenue": "الإيرادات خلال ٣٠ يومًا",
    "kpi.revenue.hint": "النسبة هي الهامش بعد تكلفة الذكاء الاصطناعي والوسائط",
    "kpi.volume": "الوحدات المنجزة",
    "kpi.volume.trend": "الوحدات المنجزة يوميًا خلال آخر ٣٠ يومًا",

    "approvals.title": "قرارات بانتظارك",
    "approvals.subject": "الموضوع {ref}",
    "approvals.more": "{count} قرارات أخرى بانتظارك في مواضع أخرى",
    "approvals.all": "فتح قائمة القرارات كاملة",
    "approvals.deciding": "جارٍ تسجيل قرارك…",
    "approvals.empty": "لا يوجد قرار بانتظارك الآن.",
    "approvals.failed": "لم يُسجَّل القرار، ولم يتغيّر شيء.",

    "notifications.title": "الإشعارات",
    "notifications.label": "إشعارات غير مقروءة",
    "notifications.dismiss": "تحديد كمقروء",
    "notifications.dismissing": "جارٍ التحديد…",
    "notifications.empty": "لا شيء غير مقروء.",
    "notice.analytics.schedule.delivered": "تم تسليم تقرير مجدول",
    "notice.analytics.schedule.undelivered": "وصل تقرير مجدول إلى بعض المستلمين فقط",
    "notice.analytics.schedule.failed": "تعذّر إنتاج تقرير مجدول",

    "activity.title": "نشاطك الأخير",
    "activity.label": "نشاطك الأخير",
    "activity.empty": "لم تُجرِ أي تغيير بعد.",

    "runs.title": "أعمال الوكلاء الأخيرة",
    "runs.label": "تشغيلات الوكلاء الأخيرة",
    "runs.empty": "لم يعمل أي وكيل بعد.",
    "runs.console": "وحدة تحكّم الوكلاء",
    "runs.state.running": "قيد التشغيل",
    "runs.state.awaiting_approval": "بانتظار الموافقة",
    "runs.state.succeeded": "اكتمل",
    "runs.state.refused": "مرفوض",
    "runs.state.failed": "أخفق",
    "runs.state.cancelled": "أُلغي",
    "runs.state.budget_stopped": "توقّف لبلوغ الميزانية",

    "areas.title": "أين يجري العمل",
    "areas.label": "الإنجاز حسب المجال خلال آخر ٣٠ يومًا",
    "areas.units": "{count} منجزة",
    "areas.empty": "لم يُقَس أي نشاط في هذه الفترة بعد.",

    "links.title": "مساحات عملك",
    "links.label": "مساحات العمل",

    "panel.failed": "تعذّر تحميل هذا الجزء. لم يتأثّر عملك؛ أعد المحاولة بعد قليل.",
    "panel.retry": "إعادة التحميل",

    "empty.title": "لا شيء ينتظرك",
    "empty.body": "لا قرارات ولا إشعارات غير مقروءة. افتح إحدى مساحات العمل لبدء العمل.",
    "empty.action": "افتح مساحة عمل"
  }
};

type Label = (key: string, vars?: Record<string, string>) => string;

function labeller(locale: string): Label {
  const table = LABELS[locale] ?? LABELS[DEFAULT_LOCALE];
  return (key, vars) => {
    const template = pseudoText(locale, table?.[key] ?? LABELS[DEFAULT_LOCALE]?.[key] ?? key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
  };
}

/* ------------------------------------------------------------------- types */

interface Approval {
  id: string;
  policyKey: string;
  module: string;
  subjectRef: string;
  requestedBy: string;
  requestedAt: number;
}

interface Notification {
  id: string;
  kind: string;
  titleKey: string;
  subjectRef: string | null;
  createdAt: number;
}

interface Inbox {
  approvals: Approval[];
  notifications: Notification[];
  counts: { approvals: number; notifications: number };
}

interface UnitEconomicsRow {
  day: string;
  module: string;
  volume: number;
  currency: string;
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
}

interface AuditRow {
  id: string;
  action: string;
  subjectRef: string | null;
  ts: number;
}

interface AiRun {
  id: string;
  agentKey: string;
  module: string;
  purpose: string;
  state: string;
  subjectRef: string | null;
  startedAt: number;
}

/**
 * What a panel knows about itself. "denied" is not a failure — the actor does
 * not hold the permission, so nothing is drawn and nothing is claimed. "error"
 * is a failure, and the difference has to survive to the screen: an empty panel
 * and a broken one look identical to a reader unless one of them says so.
 */
type Panel<T> = { state: "ok"; data: T } | { state: "denied" } | { state: "error" };

/* ------------------------------------------------------------------ loader */

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  // The shell's /v1/me is a sibling loader, not a parent value we can read, so
  // it is fetched again here — the alternative is issuing calls the actor is not
  // allowed to make and reading the 403s as answers.
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const since = Date.now() - WINDOW_MS;

  // Every branch resolves to a Panel, so one lost permission or one failing
  // endpoint costs one panel and never the screen.
  const [inbox, economics, activity, runs] = await Promise.all([
    // The inbox is the actor's own queue; the API scopes it to them, so there is
    // no permission to check before asking for it.
    panel<Inbox>(true, () => api("/v1/me/inbox", { env, request })),
    panel<{ data: UnitEconomicsRow[] }>(held.has("analytics:reports:read"), () =>
      api(`/v1/analytics/unit-economics?since=${since}`, { env, request })
    ),
    panel<{ data: AuditRow[] }>(held.has("core:audit:read"), () =>
      api(
        `/v1/core/audit-log?actorRef=${encodeURIComponent(`${me.actor.kind}:${me.actor.id}`)}&sort=ts&order=desc&limit=6`,
        { env, request }
      )
    ),
    panel<{ data: AiRun[] }>(held.has("ai:runs:read"), () =>
      api("/v1/ai/runs?sort=startedAt&order=desc&limit=5", { env, request })
    )
  ]);

  const rows = economics.state === "ok" ? economics.data.data : [];
  return {
    approvals: map(inbox, (i) => i.approvals.slice(0, 3)),
    notifications: map(inbox, (i) => i.notifications.slice(0, 6)),
    counts: inbox.state === "ok" ? inbox.data.counts : null,
    economics: economics.state === "ok" ? summarise(rows) : null,
    areas: map(economics, () => byArea(rows)),
    activity: map(activity, (a) => a.data),
    runs: map(runs, (r) => r.data)
  };
}

/**
 * A panel the actor may not open is absent, not failed — no call, no throw. A
 * runtime 403 lands in the same place: a permission list that went stale
 * mid-session should cost the actor a panel, not the page. Anything else is an
 * error the panel admits to, because silently drawing zero would be a lie.
 */
async function panel<T>(permitted: boolean, fetch: () => Promise<T>): Promise<Panel<T>> {
  if (!permitted) return { state: "denied" };
  try {
    return { state: "ok", data: await fetch() };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return error.status === 403 || error.status === 404 ? { state: "denied" } : { state: "error" };
  }
}

function map<T, U>(from: Panel<T>, to: (value: T) => U): Panel<U> {
  return from.state === "ok" ? { state: "ok", data: to(from.data) } : from;
}

/**
 * Unit economics arrive as one row per day/module/unit. The dashboard wants the
 * window, so it is folded here rather than in the browser: the client has no
 * reason to receive a thousand rows to draw four numbers.
 */
function summarise(rows: UnitEconomicsRow[]): {
  revenueMinor: number;
  costMinor: number;
  marginPct: number | null;
  volume: number;
  currency: string;
  trend: number[];
} | null {
  const currency = rows[0]?.currency;
  if (!currency) return null;

  const byDay = new Map<string, number>();
  let revenueMinor = 0;
  let costMinor = 0;
  let volume = 0;
  for (const row of rows) {
    // Mixed currencies would make a single total a lie, so only the tenant's
    // first-reported currency is summed.
    if (row.currency !== currency) continue;
    revenueMinor += row.revenueMinor;
    costMinor += row.costMinor;
    volume += row.volume;
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.volume);
  }

  return {
    revenueMinor,
    costMinor,
    marginPct: revenueMinor ? Math.round(((revenueMinor - costMinor) / revenueMinor) * 100) : null,
    volume,
    currency,
    // ISO days sort lexically, so the sparkline reads left-to-right in time.
    trend: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
  };
}

interface AreaRow {
  module: string;
  volume: number;
  revenueMinor: number;
  currency: string;
  /** Share of the busiest area, so the bar has something to be relative to. */
  share: number;
}

/** The same rows folded the other way: which parts of the business are moving. */
function byArea(rows: UnitEconomicsRow[]): AreaRow[] {
  const currency = rows[0]?.currency;
  if (!currency) return [];

  const totals = new Map<string, { volume: number; revenueMinor: number }>();
  for (const row of rows) {
    if (row.currency !== currency) continue;
    const at = totals.get(row.module) ?? { volume: 0, revenueMinor: 0 };
    at.volume += row.volume;
    at.revenueMinor += row.revenueMinor;
    totals.set(row.module, at);
  }

  const ranked = [...totals.entries()].sort(([, a], [, b]) => b.volume - a.volume).slice(0, 6);
  const top = ranked[0]?.[1].volume ?? 0;
  return ranked.map(([module, at]) => ({
    module,
    volume: at.volume,
    revenueMinor: at.revenueMinor,
    currency,
    share: top ? Math.round((at.volume / top) * 100) : 0
  }));
}

/* ------------------------------------------------------------------ action */

export async function action({
  request,
  context
}: ActionFunctionArgs): Promise<{ problem: Problem | null }> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "decide");
  const id = String(form.get("id") ?? "");
  const unknown: Problem = { title: "unknown intent", status: 400 };
  if (!id) return { problem: unknown };

  try {
    if (intent === "read") {
      await api(`/v1/me/notifications/${id}/read`, { env, request, method: "POST" });
      return { problem: null };
    }
    const decision = String(form.get("decision") ?? "");
    if (intent !== "decide" || (decision !== "approved" && decision !== "rejected")) {
      return { problem: unknown };
    }
    // Permission, dual control and the audit row are all enforced by `decide()`
    // behind this endpoint; deciding from here is a shortcut through the UI, not
    // through the policy.
    await api(`/v1/me/approvals/${id}/decide`, { env, request, method: "POST", body: { decision } });
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem };
    throw error;
  }
  return { problem: null };
}

/* ------------------------------------------------------------------ screen */

/** ai_runs.state, from packages/db/src/schema/ai.ts. */
const RUN_TONE: Record<string, BadgeTone> = {
  running: "info",
  awaiting_approval: "warning",
  succeeded: "success",
  refused: "danger",
  failed: "danger",
  cancelled: "neutral",
  budget_stopped: "warning"
};

export default function Home() {
  const loaded = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shell = useShellData();

  const locale = shell?.locale ?? DEFAULT_LOCALE;
  const label = labeller(locale);
  const t = translator(locale);
  const number = new Intl.NumberFormat(locale);

  // Rule 5: the product name is whatever this tenant calls it.
  const brand = shell?.brand?.name ?? shell?.tenantName ?? "";
  const actorName = shell?.actorName;
  const econ = loaded.economics;
  const links = (shell?.nav ?? []).filter((item) => item.href !== "/");
  const offered = new Set(links.map((item) => item.href));
  const problem = fetcher.data?.problem ?? null;
  // Which row the in-flight submission belongs to, so one busy control does not
  // freeze the other five.
  const busyId = fetcher.state === "idle" ? null : String(fetcher.formData?.get("id") ?? "");

  const submit = (fields: Record<string, string>) =>
    fetcher.submit(fields, { method: "post", action: "/?index" });

  // An actor with nothing to do and nothing to read still gets a door, not a
  // blank page.
  // Horizon's opening move: the screen says what the state of play is, in one
  // serif sentence, before it shows a single number. Derived from the inbox
  // counts the KPI wall is already drawing — nothing is inferred, so the
  // sentence carries no ✦ (it is arithmetic, not an agent).
  const answer = !loaded.counts
    ? label("answer.unknown")
    : loaded.counts.approvals
      ? label("answer.decisions")
      : loaded.counts.notifications
        ? label("answer.unread")
        : label("answer.clear");

  const barren =
    !filled(loaded.approvals) &&
    !filled(loaded.notifications) &&
    !filled(loaded.activity) &&
    !filled(loaded.runs) &&
    !econ;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        {/* Eyebrow names who is reading; the serif line answers them. The
            greeting stops being the headline because "Welcome back" is not an
            answer to anything. */}
        <Eyebrow>{actorName ? label("greeting", { name: actorName }) : label("greeting.anon")}</Eyebrow>
        <h1 className="max-w-[46ch] font-serif text-28 leading-[1.25] text-text">{answer}</h1>
        {brand ? (
          <p className="font-ui text-13 text-subtle">{label("subtitle", { brand })}</p>
        ) : null}
      </header>

      {loaded.counts || econ ? (
        <KPIWall>
          {loaded.counts ? (
            <Stat label={label("kpi.approvals")} value={number.format(loaded.counts.approvals)} />
          ) : null}
          {loaded.counts ? (
            <Stat
              label={label("kpi.notifications")}
              value={number.format(loaded.counts.notifications)}
            />
          ) : null}
          {econ ? (
            <Stat
              label={label("kpi.revenue")}
              value={
                <Money amountMinor={econ.revenueMinor} currency={econ.currency} locale={locale} />
              }
              hint={label("kpi.revenue.hint")}
              {...(econ.marginPct === null ? {} : { delta: econ.marginPct, deltaSuffix: "%" })}
            />
          ) : null}
          {econ ? (
            <Stat
              label={label("kpi.volume")}
              value={number.format(econ.volume)}
              hint={
                econ.trend.length > 1 ? (
                  <Sparkline values={econ.trend} label={label("kpi.volume.trend")} />
                ) : null
              }
            />
          ) : null}
        </KPIWall>
      ) : null}

      {problem ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="font-ui text-13 text-text">{problem.detail ?? label("approvals.failed")}</p>
          {problem.requestId ? (
            <p className="font-mono text-12 text-muted">{t("error.requestId", { id: problem.requestId })}</p>
          ) : null}
        </div>
      ) : null}

      <section aria-label={label("approvals.title")} className="flex flex-col gap-3">
        {/* Eyebrow's classes rather than <Eyebrow>: the block still needs a
            real heading in the outline, and the component is a <p>. */}
        <h2 className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">
          {label("approvals.title")}
        </h2>
        {loaded.approvals.state === "error" ? (
          <PanelFailure label={label} />
        ) : loaded.approvals.state === "ok" && loaded.approvals.data.length ? (
          loaded.approvals.data.map((approval) => (
            <ApprovalStrip
              key={approval.id}
              // ponytail: the policy key is the summary. Naming these in English
              // here would hard-code the industry's nouns into the shell — that
              // vocabulary belongs to the active domain pack (docs/21).
              summary={approval.policyKey}
              consequence={label("approvals.subject", { ref: shortRef(approval.subjectRef) })}
              requestedBy={shortRef(approval.requestedBy)}
              // Each strip is a region landmark. Sharing one name with the
              // section around them makes a landmark list of identical entries
              // (axe landmark-unique), so each carries what it is waiting on.
              label={`${label("approvals.title")}: ${approval.policyKey}`}
              // A strip mid-decision explains why its buttons are gone rather
              // than offering a second click that would race the first.
              {...(busyId === approval.id
                ? { blockedReason: label("approvals.deciding") }
                : {
                    onApprove: () => submit({ id: approval.id, decision: "approved" }),
                    onReject: () => submit({ id: approval.id, decision: "rejected" })
                  })}
            />
          ))
        ) : (
          <p className="font-ui text-13 text-subtle">{label("approvals.empty")}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-12 text-subtle">
          {loaded.approvals.state === "ok" &&
          loaded.counts &&
          loaded.counts.approvals > loaded.approvals.data.length ? (
            <span>
              {label("approvals.more", {
                count: number.format(loaded.counts.approvals - loaded.approvals.data.length)
              })}
            </span>
          ) : null}
          {/* routing.ts documents /approvals as "reached from the
              decisions-waiting panel on the home dashboard" — this is that
              link, and without it the route has no door. */}
          <Link to="/approvals" className="text-accent underline">
            {label("approvals.all")}
          </Link>
        </p>
      </section>

      {/* Deliberately not four equal cards: the two panels an actor reads line
          by line are wider than the two they scan. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <PanelCard
          title={label("activity.title")}
          panel={loaded.activity}
          label={label}
          className="lg:col-span-2"
          empty={label("activity.empty")}
          render={(rows) => (
            <Timeline
              label={label("activity.label")}
              events={rows.map(
                (entry): TimelineEvent => ({
                  id: entry.id,
                  // Audit codes (`core.session.login`) are not a sentence a
                  // person reads. ponytail: humanise, not a per-code label
                  // table nobody maintains.
                  title: humanise(entry.action),
                  at: entry.ts,
                  ...(entry.subjectRef ? { detail: shortRef(entry.subjectRef) } : {})
                })
              )}
            />
          )}
        />

        <PanelCard
          title={label("notifications.title")}
          panel={loaded.notifications}
          label={label}
          empty={label("notifications.empty")}
          render={(notes) => (
            <ul aria-label={label("notifications.label")} className="flex flex-col gap-4">
              {notes.map((note) => (
                <li key={note.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* An unknown key renders as itself: a notification nobody
                        translated should look wrong in review, not invisible. */}
                    <p className="break-words font-ui text-13 text-text">
                      {label(`notice.${note.titleKey}`)}
                    </p>
                    <p className="mt-0.5 font-ui text-12 text-subtle">
                      <DateTime value={note.createdAt} precision="minute" locale={locale} />
                    </p>
                    {note.subjectRef ? (
                      <p className="mt-0.5 break-all font-ui text-12 text-muted">
                        {shortRef(note.subjectRef)}
                      </p>
                    ) : null}
                  </div>
                  {/* Unread is a state the reader must be able to leave, or the
                      count on the KPI wall only ever goes up. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={busyId === note.id}
                    onClick={() => submit({ intent: "read", id: note.id })}
                  >
                    {busyId === note.id
                      ? label("notifications.dismissing")
                      : label("notifications.dismiss")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        />

        <PanelCard
          title={label("areas.title")}
          panel={loaded.areas}
          label={label}
          className="lg:col-span-2"
          empty={label("areas.empty")}
          render={(rows) => (
            <ul aria-label={label("areas.label")} className="flex flex-col gap-3">
              {rows.map((row) => {
                const href = `/${row.module}`;
                // Areas the actor cannot open are still counted — the business
                // is bigger than one role — but they are not links.
                const reachable = offered.has(href);
                const name = reachable ? t(labelKeyFor(href)) : row.module;
                return (
                  <li key={row.module} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="min-w-0 break-words font-ui text-13 text-text">
                        {reachable ? (
                          <Link to={href} className="underline-offset-2 hover:underline">
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </span>
                      <span className="font-ui text-12 text-subtle">
                        {label("areas.units", { count: number.format(row.volume) })} ·{" "}
                        <Money
                          amountMinor={row.revenueMinor}
                          currency={row.currency}
                          locale={locale}
                        />
                      </span>
                    </div>
                    {/* A bar, not a chart: the comparison is the whole point and
                        the numbers are already on the row. */}
                    <div className="h-1 rounded-orbit bg-surface-2" aria-hidden="true">
                      <div
                        className="h-1 rounded-orbit bg-accent"
                        style={{ inlineSize: `${Math.max(row.share, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        />

        <PanelCard
          title={label("runs.title")}
          panel={loaded.runs}
          label={label}
          empty={label("runs.empty")}
          {...(offered.has("/admin")
            ? {
                actions: (
                  <Link to="/admin/ai/console" className="font-ui text-12 text-accent underline">
                    {label("runs.console")}
                  </Link>
                )
              }
            : {})}
          render={(runs) => (
            <ul aria-label={label("runs.label")} className="flex flex-col gap-4">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-ui text-13 text-text">
                      {run.agentKey}
                    </span>
                    <Badge tone={RUN_TONE[run.state] ?? "neutral"} size="sm">
                      {label(`runs.state.${run.state}`)}
                    </Badge>
                  </div>
                  <p className="break-words font-ui text-12 text-subtle">
                    {run.purpose} ·{" "}
                    <DateTime value={run.startedAt} precision="minute" locale={locale} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        />
      </div>

      {links.length ? (
        <nav aria-label={label("links.label")} className="flex flex-col gap-3">
          <h2 className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">
            {label("links.title")}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className="flex h-10 items-center gap-2.5 overflow-hidden rounded-md border border-border pe-3 font-ui text-13 text-text transition-colors duration-150 hover:border-border-strong hover:bg-surface-2"
                >
                  {/* The module signs its own door: 2px of its hue, the same
                      bar the sidebar draws beside the current item. */}
                  <span
                    aria-hidden="true"
                    className="h-full w-0.5 shrink-0"
                    style={{ background: hueVar(moduleOf(item.href)) }}
                  />
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {barren ? (
        <EmptyState
          title={label("empty.title")}
          body={label("empty.body")}
          {...(links[0]
            ? {
                action: (
                  <Link
                    to={links[0].href}
                    className="inline-flex h-10 items-center rounded-md border border-border px-3 font-ui text-13 text-text hover:bg-surface-2"
                  >
                    {label("empty.action")}
                  </Link>
                )
              }
            : {})}
        />
      ) : null}
    </div>
  );
}

function filled(panel: Panel<unknown[]>): boolean {
  return panel.state === "ok" && panel.data.length > 0;
}

/**
 * One card, three outcomes. A denied panel renders nothing at all: a wall of
 * "you may not see this" cards teaches an actor about permissions they never
 * asked for, and absence says the same thing more quietly.
 */
function PanelCard<T>({
  title,
  panel,
  label,
  empty,
  render,
  className,
  actions
}: {
  title: string;
  panel: Panel<T[]>;
  label: Label;
  empty: string;
  render: (rows: T[]) => React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  if (panel.state === "denied") return null;
  return (
    <Card title={title} {...(className ? { className } : {})} {...(actions ? { actions } : {})}>
      {panel.state === "error" ? (
        <PanelFailure label={label} />
      ) : panel.data.length ? (
        render(panel.data)
      ) : (
        <p className="font-ui text-13 text-subtle">{empty}</p>
      )}
    </Card>
  );
}

/** A panel that broke says so, and offers the one action that can fix it. */
function PanelFailure({ label }: { label: Label }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="font-ui text-13 text-muted">{label("panel.failed")}</p>
      <Link to="/" reloadDocument className="font-ui text-12 text-accent underline">
        {label("panel.retry")}
      </Link>
    </div>
  );
}
