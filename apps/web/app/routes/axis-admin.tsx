import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Badge, Button, Card, EmptyState, Stat, Table, type BadgeTone, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { pseudoText, translator } from "../i18n";
import { tag } from "./detail-kit";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// docs/03 §AXIS admin. Three things an AXIS admin needs that no generated
// list gives them: publishing a SOP version (the swap has to be atomic — see
// apps/api/src/routes/axis.ts), a read on whether the tenant's outbound
// webhooks are actually delivering, and the door into SLA/routing/queue
// policy, which is otherwise a plain generated resource (the `ops-policies`
// module tab) and does not need a bespoke editor here.

/* --------------------------------------------------------------- contract */

export const PERM = {
  sopsRead: "axis:sops:read",
  sopsWrite: "axis:sops:write",
  hooksRead: "core:webhooks:read"
} as const;

export interface SopRow {
  id: string;
  key: string;
  version: number;
  status: string;
  appliesTo: string | null;
  createdAt: number;
}

export interface HookRow {
  id: string;
  url: string;
  status: string;
}

export interface DeliveryRow {
  webhookId: string;
  status: string;
  createdAt: number;
}

export interface HealthRow {
  webhookId: string;
  url: string;
  status: string;
  delivered: number;
  failed: number;
  dead: number;
  pending: number;
  lastDeliveryAt: number | null;
}

/** Per-webhook delivery counts, from the tables core.ts already exposes generically. */
export function connectorHealth(hooks: HookRow[], deliveries: DeliveryRow[]): HealthRow[] {
  return hooks.map((hook) => {
    const rows = deliveries.filter((d) => d.webhookId === hook.id);
    return {
      webhookId: hook.id,
      url: hook.url,
      status: hook.status,
      delivered: rows.filter((r) => r.status === "delivered").length,
      failed: rows.filter((r) => r.status === "failed").length,
      dead: rows.filter((r) => r.status === "dead").length,
      pending: rows.filter((r) => r.status === "pending").length,
      lastDeliveryAt: rows.reduce<number | null>((max, r) => (max === null || r.createdAt > max ? r.createdAt : max), null)
    };
  });
}

export function connectorTone(row: Pick<HealthRow, "dead" | "failed">): BadgeTone {
  if (row.dead > 0) return "danger";
  if (row.failed > 0) return "warning";
  return "success";
}

/* ----------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "AXIS admin",
    intro: "Publish procedures, read connector health, and reach operating policy.",
    deniedTitle: "You cannot read AXIS admin settings",
    sopsTitle: "Procedures",
    sopsIntro: "The version marked active is the one cases follow. Publishing one retires whichever version it replaces.",
    sopsCaption: "Procedure versions",
    sopsEmpty: "No procedures yet.",
    colKey: "Procedure",
    colVersion: "Version",
    colStatus: "Status",
    colApplies: "Applies to",
    publish: "Publish",
    "status.draft": "Draft",
    "status.active": "Active",
    "status.retired": "Retired",
    opsTitle: "Operating policy",
    opsIntro: "SLA, routing and queue policy for this tenant.",
    opsManage: "Open operating policy",
    connectorsTitle: "Connector health",
    connectorsIntro: "Outbound webhook delivery over the deliveries recorded so far.",
    connectorsCaption: "Webhooks",
    connectorsEmpty: "No webhook is configured.",
    colUrl: "Endpoint",
    colDelivered: "Delivered",
    colFailed: "Failed",
    colDead: "Dead",
    colPending: "Pending",
    hooksManage: "Manage webhooks in the developer console"
  },
  ar: {
    title: "إدارة AXIS",
    intro: "انشر الإجراءات، اطّلع على سلامة الموصلات، وادخل إلى سياسات التشغيل.",
    deniedTitle: "لا يمكنك قراءة إعدادات إدارة AXIS",
    sopsTitle: "الإجراءات",
    sopsIntro: "النسخة المفعّلة هي التي تتبعها الحالات. نشر نسخة يسحب النسخة التي تحل محلها.",
    sopsCaption: "نسخ الإجراءات",
    sopsEmpty: "لا توجد إجراءات بعد.",
    colKey: "الإجراء",
    colVersion: "النسخة",
    colStatus: "الحالة",
    colApplies: "ينطبق على",
    publish: "نشر",
    "status.draft": "مسودة",
    "status.active": "نشطة",
    "status.retired": "مسحوبة",
    opsTitle: "سياسة التشغيل",
    opsIntro: "سياسات الخدمة والتوجيه وقائمة الانتظار لهذه المؤسسة.",
    opsManage: "افتح سياسة التشغيل",
    connectorsTitle: "سلامة الموصلات",
    connectorsIntro: "تسليم الويب هوك الصادر بحسب عمليات التسليم المسجّلة حتى الآن.",
    connectorsCaption: "الويب هوك",
    connectorsEmpty: "لا يوجد ويب هوك مهيّأ.",
    colUrl: "نقطة النهاية",
    colDelivered: "تم التسليم",
    colFailed: "فشل",
    colDead: "متوقف",
    colPending: "قيد الانتظار",
    hooksManage: "إدارة الويب هوك في وحدة تحكم المطورين"
  }
};

export function labelsIn(locale: string): (key: string, vars?: Record<string, string>) => string {
  const t = translator(locale);
  const table = LABELS[locale] ?? LABELS.en!;
  const fallback = LABELS.en!;
  return (key, vars) => {
    const local = table[key] ?? fallback[key];
    // `t()` pseudoizes on its own; only the route's own table needs the wrap.
    const shared = local === undefined ? t(`common.${key}`) : pseudoText(locale, local);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return fallback;
    throw error;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = {
    sopsRead: held.has(PERM.sopsRead),
    sopsWrite: held.has(PERM.sopsWrite),
    hooksRead: held.has(PERM.hooksRead)
  };

  const [sops, hooks, deliveries] = await Promise.all([
    may.sopsRead
      ? safe(() => api<{ data: SopRow[] }>("/v1/axis/sops?limit=100", { env, request }), { data: [] })
      : { data: [] },
    may.hooksRead
      ? safe(() => api<{ data: HookRow[] }>("/v1/core/webhooks?limit=100", { env, request }), { data: [] })
      : { data: [] },
    may.hooksRead
      ? safe(
          // 200 is the backend's MAX_PAGE (apps/api/src/http.ts) — this is a health
          // snapshot, not an export, so the cap is plenty for per-webhook counts.
          () => api<{ data: DeliveryRow[] }>("/v1/core/webhook-deliveries?limit=200&sort=createdAt&order=desc", { env, request }),
          { data: [] }
        )
      : { data: [] }
  ]);

  return {
    may,
    sops: sops.data,
    health: connectorHealth(hooks.data, deliveries.data),
    problem: null as Problem | null,
    idempotencyKey: crypto.randomUUID()
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const nothing = { problem: null as Problem | null, published: null as string | null };
  const intent = String(form.get("intent") ?? "");
  if (intent !== "publish") return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  const sopId = String(form.get("sopId") ?? "").trim();
  if (!sopId) return { ...nothing, problem: { title: "sop required", status: 400 } };

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    const published = await api<{ id: string; status: string }>(`/v1/axis/sops/${encodeURIComponent(sopId)}/publish`, {
      env,
      request,
      method: "POST",
      ...(key ? { headers: { "idempotency-key": key } } : {})
    });
    return { ...nothing, published: published.id };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function AxisAdmin() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const busy = useNavigation().state !== "idle";

  if (!loaded.may.sopsRead && !loaded.may.hooksRead) {
    return (
      <div className="flex flex-col gap-6">
        <Header l={l} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const sopColumns: Array<Column<SopRow>> = [
    { key: "key", header: l("colKey"), render: (row) => <span className="font-mono text-12">{row.key}</span> },
    { key: "version", header: l("colVersion"), numeric: true, render: (row) => row.version },
    {
      key: "status",
      header: l("colStatus"),
      render: (row) => (
        <Badge tone={row.status === "active" ? "success" : row.status === "retired" ? "neutral" : "info"} size="sm" dot>
          {tag(l, "status", row.status)}
        </Badge>
      )
    },
    { key: "appliesTo", header: l("colApplies"), render: (row) => row.appliesTo ?? "" },
    {
      key: "publish",
      header: t("common.actions"),
      render: (row) =>
        loaded.may.sopsWrite && row.status !== "active" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />
            <input type="hidden" name="sopId" value={row.id} />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <Button type="submit" variant="ghost" size="sm" loading={busy}>
              {l("publish")}
            </Button>
          </Form>
        ) : null
    }
  ];

  const healthColumns: Array<Column<HealthRow>> = [
    { key: "url", header: l("colUrl"), render: (row) => <span className="font-mono text-12 break-all">{row.url}</span> },
    { key: "delivered", header: l("colDelivered"), numeric: true, render: (row) => row.delivered },
    {
      key: "failed",
      header: l("colFailed"),
      numeric: true,
      render: (row) => (
        <Badge tone={connectorTone(row)} size="sm">
          {row.failed}
        </Badge>
      )
    },
    { key: "dead", header: l("colDead"), numeric: true, render: (row) => row.dead },
    { key: "pending", header: l("colPending"), numeric: true, render: (row) => row.pending }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header l={l} />

      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}

      {loaded.may.sopsRead ? (
        <Card title={l("sopsTitle")} description={l("sopsIntro")}>
          <Table
            caption={l("sopsCaption")}
            columns={sopColumns}
            rows={loaded.sops}
            rowKey={(row) => row.id}
            rowState={(row) => (row.status === "retired" ? "sealed" : undefined)}
            empty={<EmptyState title={l("sopsEmpty")} />}
          />
        </Card>
      ) : null}

      <Card title={l("opsTitle")} description={l("opsIntro")}>
        <Link to="/axis/ops-policies" className="font-ui text-13 text-accent underline underline-offset-2">
          {l("opsManage")}
        </Link>
      </Card>

      {loaded.may.hooksRead ? (
        <Card title={l("connectorsTitle")} description={l("connectorsIntro")}>
          <div className="flex flex-col gap-3">
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label={l("colDelivered")} value={String(loaded.health.reduce((sum, r) => sum + r.delivered, 0))} />
              <Stat label={l("colFailed")} value={String(loaded.health.reduce((sum, r) => sum + r.failed, 0))} />
              <Stat label={l("colDead")} value={String(loaded.health.reduce((sum, r) => sum + r.dead, 0))} />
              <Stat label={l("colPending")} value={String(loaded.health.reduce((sum, r) => sum + r.pending, 0))} />
            </div>
            <Table
              caption={l("connectorsCaption")}
              columns={healthColumns}
              rows={loaded.health}
              rowKey={(row) => row.webhookId}
              empty={<EmptyState title={l("connectorsEmpty")} />}
            />
            <Link to="/admin/developer" className="font-ui text-13 text-accent underline underline-offset-2">
              {l("hooksManage")}
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Header({ l }: { l: (key: string) => string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="font-serif text-24 leading-[1.2] text-text">{l("title")}</h1>
      <p className="max-w-prose font-ui text-13 text-muted">{l("intro")}</p>
    </header>
  );
}
