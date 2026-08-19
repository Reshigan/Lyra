import type * as React from "react";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  type LoaderFunctionArgs
} from "react-router";
import { Button, Card, DateTime, EmptyState, Field, LineChart, Select, Stat, Table } from "@lyra/ui";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { useNorthSessionData } from "./north-shell";
import {
  MetricValue,
  labelsFrom,
  metricName,
  parsed,
  pct,
  readable,
  type Labels,
  type Metric,
  type Page,
  type Snapshot
} from "./north-shared";

// Metric Explorer (docs/modules/north.md §4 screen 2): one metric, its series,
// and the definition it was computed from. The semantic layer is the only
// source — the screen reads north_snapshots through the snapshots resource and
// never composes a number of its own.

/* --------------------------------------------------------------- constants */

export const PERM = { read: "north:snapshots:read" } as const;

const WINDOW = 90;
const GRAINS = ["day", "week", "month"] as const;

/* ------------------------------------------------------------------ labels */

const LABELS: Labels = {
  en: {
    title: "Metric explorer",
    kicker: "One metric, its series, and the definition behind it",
    intro:
      "Every point is a closed snapshot from the semantic layer. Change the definition and the change shows here as an annotation, not a silent restatement.",
    metric: "Metric",
    grain: "Grain",
    day: "Daily",
    week: "Weekly",
    month: "Monthly",
    apply: "Show series",
    "series.title": "Series",
    "series.caption": "Snapshot values for the selected metric, oldest first",
    "series.period": "Period",
    "series.value": "Value",
    "series.change": "Change",
    "series.taken": "Snapshot taken",
    "series.none.title": "No snapshots for this metric yet",
    "series.none.body":
      "The snapshotter writes a row when the period closes. Run it from NORTH dev if you need one before the nightly window.",
    "stat.latest": "Latest",
    "stat.periods": "Periods held",
    "stat.change": "Change on prior",
    "definition.title": "How this metric is defined",
    "definition.sql": "Computed from",
    "definition.owner": "Owner",
    "definition.sensitivity": "Sensitivity",
    "definition.direction": "Better when",
    "definition.target": "Target",
    "definition.unset": "Not recorded",
    "definition.edit": "Edit this definition in NORTH admin",
    up: "Rising",
    down: "Falling",
    public: "Public",
    internal: "Internal",
    restricted: "Restricted",
    "metrics.none.title": "No metrics are registered",
    "metrics.none.body": "A tenant administrator registers metrics in NORTH admin before anything can be explored.",
    denied: "You do not have permission to read snapshots. Ask a tenant administrator for NORTH metric access."
  },
  ar: {
    title: "مستكشف المؤشرات",
    kicker: "مؤشر واحد، وسلسلته، والتعريف الذي وراءه",
    intro: "كل نقطة لقطة مغلقة من الطبقة الدلالية. أي تغيير في التعريف يظهر هنا كتعليق توضيحي لا كإعادة صياغة صامتة.",
    metric: "المؤشر",
    grain: "التفصيل",
    day: "يومي",
    week: "أسبوعي",
    month: "شهري",
    apply: "اعرض السلسلة",
    "series.title": "السلسلة",
    "series.caption": "قيم اللقطات للمؤشر المحدد، من الأقدم إلى الأحدث",
    "series.period": "الفترة",
    "series.value": "القيمة",
    "series.change": "التغير",
    "series.taken": "وقت اللقطة",
    "series.none.title": "لا توجد لقطات لهذا المؤشر بعد",
    "series.none.body": "يكتب المُلقِط صفاً عند إغلاق الفترة. شغّله من قسم تطوير نورث إذا احتجت لقطة قبل النافذة الليلية.",
    "stat.latest": "الأحدث",
    "stat.periods": "عدد الفترات",
    "stat.change": "التغير عن السابق",
    "definition.title": "كيف يُعرَّف هذا المؤشر",
    "definition.sql": "محسوب من",
    "definition.owner": "المسؤول",
    "definition.sensitivity": "الحساسية",
    "definition.direction": "الأفضل عندما",
    "definition.target": "المستهدف",
    "definition.unset": "غير مسجل",
    "definition.edit": "عدّل هذا التعريف في إدارة نورث",
    up: "يرتفع",
    down: "ينخفض",
    public: "عام",
    internal: "داخلي",
    restricted: "مقيد",
    "metrics.none.title": "لا توجد مؤشرات مسجلة",
    "metrics.none.body": "يسجّل مدير المستأجر المؤشرات في إدارة نورث قبل أن يكون هناك ما يُستكشف.",
    denied: "لا تملك صلاحية قراءة اللقطات. اطلب من مدير المستأجر صلاحية مؤشرات نورث."
  }
};

const labelsIn = (locale: string) => labelsFrom(LABELS, locale);

/* ----------------------------------------------------------------- helpers */

/**
 * Basis-point change of the last snapshot on the one before it. `null` when
 * there is no prior, or when the prior was zero and a ratio would be infinite.
 */
export function deltaBps(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const last = values[values.length - 1]!;
  const prior = values[values.length - 2]!;
  if (prior === 0) return null;
  return Math.round(((last - prior) / Math.abs(prior)) * 10_000);
}

/**
 * The direction a hero can headline the metric's latest move with. `null`
 * when there is nothing to report yet — fewer than two snapshots, or no
 * change at all — so the headline falls back to naming the metric instead of
 * guessing a trend that isn't there.
 */
export function headlineDirection(values: readonly number[]): "up" | "down" | null {
  const bps = deltaBps(values);
  if (!bps) return null;
  return bps > 0 ? "up" : "down";
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const url = new URL(request.url);

  const metrics = (await readable(api<Page<Metric>>("/v1/north/metrics?limit=200", opts)))?.data ?? [];
  const asked = url.searchParams.get("metric");
  const metric = metrics.find((row) => row.key === asked) ?? metrics[0] ?? null;
  const grain = GRAINS.find((one) => one === url.searchParams.get("grain")) ?? metric?.grain ?? "day";
  // ?asOf=<epoch-ms> replays the series as of a past moment (Meridian's
  // replay mode) — an upper time bound on the snapshots query.
  const asOf = url.searchParams.get("asOf")?.trim();
  // A non-numeric ?asOf= is not a moment — replay stays off rather than
  // sending `&to=NaN` upstream.
  const to = asOf && Number.isFinite(Number(asOf)) ? `&to=${encodeURIComponent(asOf)}` : "";

  // Newest first, then flipped for the chart: a tenant with more history than
  // WINDOW wants the recent end of it, not the first 90 periods it ever had.
  // Dimensional rows (dims_hash != "") are slices of a period, not extra
  // points, and the list API can't exclude them — an empty filter value is
  // dropped — so over-fetch and drop them here.
  const page = metric
    ? await readable(
        api<Page<Snapshot>>(
          `/v1/north/snapshots?metricKey=${encodeURIComponent(metric.key)}&grain=${grain}&sort=period&order=desc&limit=${WINDOW * 4}${to}`,
          opts
        )
      )
    : { data: [] as Snapshot[] };
  const snapshots = page ? page.data.filter((row) => !row.dimsHash).slice(0, WINDOW).reverse() : null;

  return { metrics, metric, grain, snapshots };
}

/* --------------------------------------------------------------- the screen */

export default function NorthExplorer() {
  const { metrics, metric, grain, snapshots } = useLoaderData<typeof loader>();
  const shell = useNorthSessionData();
  const navigation = useNavigation();

  const locale = shell?.locale ?? "en";
  const l = labelsIn(locale);
  const busy = navigation.state !== "idle";

  const rows = snapshots ?? [];
  const values = rows.map((row) => row.value);
  const direction = headlineDirection(values);
  const change = pct(deltaBps(values), locale);
  const target = parsed<{ value?: number } | null>(metric?.targetJson, null);

  const shown = (value: number) => (
    <MetricValue value={value} unit={metric?.unit ?? "count"} currency={metric?.currency ?? null} locale={locale} />
  );

  // The headline narrates the actual series rather than repeating the kicker:
  // the metric's name plus which way its last two snapshots moved, when there
  // are enough of them to say so. This is arithmetic on real snapshot values
  // (deltaBps above), not a model call, so it carries no ✦ mark.
  const headline =
    metric && direction ? (
      <>
        {metricName(metric, locale)} {l(direction)} {change}
      </>
    ) : metric ? (
      metricName(metric, locale)
    ) : (
      l("title")
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-12 uppercase tracking-[0.14em] text-subtle">{l("kicker")}</span>
        <h1 className="font-serif text-22 leading-[1.2] text-text">{headline}</h1>
        <p className="max-w-[var(--measure-prose)] font-ui text-13 text-subtle">{l("intro")}</p>
        {metric ? (
          <Link
            to={`/north/admin?metric=${encodeURIComponent(metric.id)}`}
            className="w-fit font-ui text-13 text-accent underline"
          >
            {l("definition.edit")}
          </Link>
        ) : null}
      </header>

      {metrics.length === 0 ? (
        <EmptyState title={l("metrics.none.title")} body={l("metrics.none.body")} />
      ) : (
        <>
          {/* A GET form: the chosen metric and grain live in the URL, so a
              series a person is reading can be sent to somebody else. */}
          <Form method="get" className="flex flex-wrap items-end gap-4">
            <Field label={l("metric")}>
              <Select
                name="metric"
                defaultValue={metric?.key ?? ""}
                aria-label={l("metric")}
                options={metrics.map((row) => ({ value: row.key, label: metricName(row, locale) }))}
              />
            </Field>
            <Field label={l("grain")}>
              <Select
                name="grain"
                defaultValue={grain}
                aria-label={l("grain")}
                options={GRAINS.map((one) => ({ value: one, label: l(one) }))}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {l("apply")}
            </Button>
          </Form>

          {snapshots === null ? (
            <Card><p className="font-ui text-13 text-subtle">{l("denied")}</p></Card>
          ) : rows.length === 0 ? (
            <EmptyState title={l("series.none.title")} body={l("series.none.body")} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label={l("stat.latest")} value={shown(values[values.length - 1]!)} />
                <Stat label={l("stat.periods")} value={String(rows.length)} />
                <Stat label={l("stat.change")} value={change ?? "—"} />
              </div>

              <Card>
                <LineChart
                  values={values}
                  label={metric ? metricName(metric, locale) : l("series.title")}
                  xLabels={rows.map((row) => row.period)}
                />
              </Card>

              <Card>
                <Table
                  caption={l("series.caption")}
                  rows={[...rows].reverse()}
                  rowKey={(row) => row.id}
                  columns={[
                    { key: "period", header: l("series.period"), render: (row) => row.period },
                    { key: "value", header: l("series.value"), numeric: true, render: (row) => shown(row.value) },
                    {
                      key: "taken",
                      header: l("series.taken"),
                      render: (row) => <DateTime value={row.ts} locale={locale} />
                    }
                  ]}
                />
              </Card>
            </>
          )}

          {metric ? (
            <Card>
              <h2 className="mb-3 font-serif text-16 text-text">{l("definition.title")}</h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Definition term={l("definition.sql")} value={metric.definitionSqlRef ?? l("definition.unset")} mono />
                <Definition term={l("definition.owner")} value={metric.owner ?? l("definition.unset")} />
                <Definition term={l("definition.sensitivity")} value={l(metric.sensitivity)} />
                <Definition term={l("definition.direction")} value={l(metric.direction)} />
                <Definition
                  term={l("definition.target")}
                  value={
                    typeof target?.value === "number" ? shown(target.value) : l("definition.unset")
                  }
                />
              </dl>
              <p className="mt-3 font-mono text-11 uppercase tracking-[0.14em] text-subtle">{metric.key}</p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Definition({ term, value, mono = false }: { term: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-ui text-12 uppercase tracking-[0.14em] text-subtle">{term}</dt>
      <dd className={mono ? "font-mono text-12 text-text" : "font-ui text-13 text-text"}>{value}</dd>
    </div>
  );
}
