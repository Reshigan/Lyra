import { useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { AgentBadge, Badge, Button, Card, ConfidenceMeter, DateTime, Drawer, EmptyState, GhostText, Money, Select, Stat, Table, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { Entry, Facts, Header, Payload, labelsFrom, rowsOf, safe, tag, type Page } from "./detail-kit";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// One AXIS work item: where it stands, the steps that got it there, what is
// waiting on sign-off, and the two transitions the API actually owns — move the
// case on (`PATCH /v1/axis/cases/:id`) and verify a document
// (`POST /v1/axis/documents/:id/verify`). Nothing here invents a transition.

/* --------------------------------------------------------------- contract */

export interface Case {
  id: string;
  ref: string;
  kind: string;
  customerId?: string | null;
  productLine?: string | null;
  channelId?: string | null;
  quoteRequestId?: string | null;
  status: string;
  slaDueAt?: number | null;
  ownerRef?: string | null;
  teamId?: string | null;
  priority: string;
  source: string;
  riskScore?: number | null;
  valueMinor?: number | null;
  currency?: string | null;
  metaJson?: unknown;
  closedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EventRow {
  id: string;
  step: string;
  actorRef: string;
  durationMs?: number | null;
  outcome?: string | null;
  ts: number;
}

export interface DocumentRow {
  id: string;
  docType: string;
  status: string;
  extractionConfidence?: number | null;
  verifiedAt?: number | null;
  createdAt: number;
}

export interface CaseApprovalRow {
  id: string;
  subjectRef: string;
  policyKey: string;
  decision: string;
  ts: number;
}

export interface TaskRow {
  id: string;
  type: string;
  titleKey: string;
  assigneeRef?: string | null;
  state: string;
  dueAt?: number | null;
}

export const PERM = {
  read: "axis:cases:read",
  update: "axis:cases:update",
  documents: "axis:documents:read",
  verify: "axis:documents:verify",
  approvals: "axis:cases:approve",
  events: "axis:metrics:read",
  tasks: "axis:tasks:read",
  export: "compliance:evidence:export",
  download: "compliance:evidence:read",
  copilot: "axis:cases:read"
} as const;

/** The case state machine as apps/db declares it (axis_cases.status). */
export const STATES = [
  "intake",
  "quoting",
  "awaiting_docs",
  "review",
  "approval",
  "issued",
  "failed",
  "cancelled"
] as const;

/* ---------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    intro: "Where this work item stands, the steps behind it, and what is still waiting on someone.",
    back: "Back to the queue",
    standingTitle: "Where it stands",
    value: "Value",
    sla: "Due",
    risk: "Risk score",
    owner: "Owner",
    team: "Team",
    priority: "Priority",
    source: "Came from",
    kind: "Kind",
    productLine: "Product line",
    holder: "Customer",
    channel: "Channel",
    quoteRequest: "Shopping request",
    closedAt: "Closed",
    metaTitle: "Case data",
    exportTitle: "Audit export",
    exportIntro: "Build a regulator-ready evidence bundle of everything recorded on this work item.",
    exportSubmit: "Build the bundle",
    exported: "The bundle is ready.",
    download: "Download",
    copilotTitle: "Ask the case copilot",
    copilotPlaceholder: "Ask a question about this case…",
    copilotSubmit: "Ask",
    copilotEmpty: "Ask a question and the answer will appear here, grounded in this case's own facts.",
    moveTitle: "Move it on",
    moveIntro: "Set where the work item stands. The state machine is the record; nothing else moves it.",
    moveTo: "Move to",
    moveSubmit: "Move the work item",
    moved: "The work item was moved.",
    stateRequired: "Choose a state to move to.",
    eventsTitle: "Steps",
    eventsCaption: "Every step recorded on this work item, newest first.",
    documentsTitle: "Documents",
    documentsCaption: "Evidence filed on this work item. Verifying one is a decision, and it is recorded.",
    verify: "Verify",
    verified: "The document was verified.",
    documentRequired: "Pick a document to verify.",
    approvalsTitle: "Sign-off",
    approvalsCaption: "Every approval raised while working this item.",
    tasksTitle: "Work",
    tasksCaption: "Tasks opened against this work item.",
    colStep: "Step",
    colDuration: "Took",
    colConfidence: "Confidence",
    colPolicyKey: "Rule",
    colSubject: "Subject",
    colTask: "Task",
    colAssignee: "With",
    colDue: "Due",
    "state.in_progress": "In progress",
    "state.blocked": "Blocked",
    "state.done": "Done",
    "state.cancelled": "Cancelled",
    "source.web": "Website",
    "source.orbit": "Conversation",
    "source.partner": "Partner",
    "source.import": "Import",
    "source.api": "Interface",
    "source.agent": "Automation",
    "kind.quote": "Pricing",
    "kind.bind": "Sale",
    "kind.endorse": "Endorsement",
    "kind.renewal_ops": "Renewal work",
    "kind.group_medical": "Group medical",
    "kind.kyc": "Identity check",
    "kind.claim": "Claim"
  },
  ar: {
    intro: "موقف بند العمل، والخطوات التي أوصلته، وما لا يزال بانتظار أحد.",
    back: "العودة إلى قائمة العمل",
    standingTitle: "الموقف",
    value: "القيمة",
    sla: "الاستحقاق",
    risk: "درجة الخطر",
    owner: "المسؤول",
    team: "الفريق",
    priority: "الأولوية",
    source: "المصدر",
    kind: "النوع",
    productLine: "خط المنتج",
    holder: "العميل",
    channel: "القناة",
    quoteRequest: "طلب التسعير",
    closedAt: "تاريخ الإغلاق",
    metaTitle: "بيانات البند",
    exportTitle: "تصدير للتدقيق",
    exportIntro: "إنشاء حزمة أدلة جاهزة للجهة الرقابية بكل ما هو مسجّل على بند العمل هذا.",
    exportSubmit: "إنشاء الحزمة",
    exported: "الحزمة جاهزة.",
    download: "تنزيل",
    copilotTitle: "اسأل مساعد الحالة",
    copilotPlaceholder: "اطرح سؤالاً حول هذه الحالة…",
    copilotSubmit: "اسأل",
    copilotEmpty: "اطرح سؤالاً وستظهر الإجابة هنا، مستندة إلى وقائع هذه الحالة.",
    moveTitle: "تحريك البند",
    moveIntro: "حدّد موقف بند العمل. آلة الحالات هي السجل، ولا شيء آخر يحرّكه.",
    moveTo: "الانتقال إلى",
    moveSubmit: "تحريك بند العمل",
    moved: "تم تحريك بند العمل.",
    stateRequired: "اختر الحالة المطلوبة.",
    eventsTitle: "الخطوات",
    eventsCaption: "كل خطوة مسجّلة على بند العمل، الأحدث أولًا.",
    documentsTitle: "المستندات",
    documentsCaption: "الأدلة المرفقة بهذا البند. توثيق المستند قرار، ويُسجّل.",
    verify: "توثيق",
    verified: "تم توثيق المستند.",
    documentRequired: "اختر مستندًا للتوثيق.",
    approvalsTitle: "الاعتماد",
    approvalsCaption: "كل موافقة طُلبت أثناء العمل على هذا البند.",
    tasksTitle: "المهام",
    tasksCaption: "المهام المفتوحة على بند العمل.",
    colStep: "الخطوة",
    colDuration: "المدة",
    colConfidence: "درجة الثقة",
    colPolicyKey: "القاعدة",
    colSubject: "الموضوع",
    colTask: "المهمة",
    colAssignee: "المسؤول",
    colDue: "الاستحقاق",
    "state.in_progress": "قيد التنفيذ",
    "state.blocked": "متعثرة",
    "state.done": "منجزة",
    "state.cancelled": "ملغاة",
    "source.web": "الموقع",
    "source.orbit": "محادثة",
    "source.partner": "شريك",
    "source.import": "استيراد",
    "source.api": "واجهة برمجية",
    "source.agent": "أتمتة",
    "kind.quote": "تسعير",
    "kind.bind": "بيع",
    "kind.endorse": "تعديل",
    "kind.renewal_ops": "أعمال التجديد",
    "kind.group_medical": "طبي جماعي",
    "kind.kyc": "التحقق من الهوية",
    "kind.claim": "مطالبة"
  }
};

export const labelsIn = labelsFrom(LABELS);

/* ------------------------------------------------------------------ loader */

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const options = { env, request };
  const may = {
    read: held.has(PERM.read),
    update: held.has(PERM.update),
    verify: held.has(PERM.verify),
    export: held.has(PERM.export),
    copilot: held.has(PERM.copilot)
  };

  const empty = {
    workItem: null as Case | null,
    events: [] as EventRow[],
    documents: [] as DocumentRow[],
    approvals: [] as CaseApprovalRow[],
    tasks: [] as TaskRow[],
    may,
    idempotencyKey: crypto.randomUUID()
  };

  if (!may.read) return empty;
  const scope = `?caseId=${encodeURIComponent(id)}&limit=50`;
  const [workItem, events, documents, approvals, tasks] = await Promise.all([
    safe(() => api<Case>(`/v1/axis/cases/${id}`, options), null),
    held.has(PERM.events)
      ? safe(() => api<Page<EventRow>>(`/v1/axis/process-events${scope}&sort=ts&order=desc`, options), null)
      : null,
    held.has(PERM.documents) ? safe(() => api<Page<DocumentRow>>(`/v1/axis/documents${scope}`, options), null) : null,
    held.has(PERM.approvals)
      ? safe(() => api<Page<CaseApprovalRow>>(`/v1/axis/case-approvals${scope}`, options), null)
      : null,
    held.has(PERM.tasks) ? safe(() => api<Page<TaskRow>>(`/v1/axis/tasks${scope}`, options), null) : null
  ]);

  if (!workItem) return empty;
  return {
    ...empty,
    workItem,
    events: rowsOf(events),
    documents: rowsOf(documents),
    approvals: rowsOf(approvals),
    tasks: rowsOf(tasks)
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id ?? String(form.get("id") ?? "");
  const key = String(form.get("idempotencyKey") ?? "");
  const nothing = {
    done: null as string | null,
    problem: null as Problem | null,
    error: null as string | null,
    bundleId: null as string | null,
    answer: null as string | null,
    confidence: null as number | null
  };
  const headers = key ? { headers: { "idempotency-key": key } } : {};

  try {
    if (intent === "move") {
      const status = String(form.get("status") ?? "");
      if (!(STATES as readonly string[]).includes(status)) return { ...nothing, error: "stateRequired" };
      await api<Case>(`/v1/axis/cases/${id}`, { env, request, method: "PATCH", ...headers, body: { status } });
      return { ...nothing, done: "moved" };
    }
    if (intent === "verify") {
      const documentId = String(form.get("documentId") ?? "").trim();
      if (!documentId) return { ...nothing, error: "documentRequired" };
      await api<unknown>(`/v1/axis/documents/${documentId}/verify`, { env, request, method: "POST", ...headers });
      return { ...nothing, done: "verified" };
    }
    if (intent === "export") {
      const bundle = await api<{ id: string }>("/v1/compliance/evidence-bundles/export", {
        env,
        request,
        method: "POST",
        ...headers,
        body: { purpose: "internal", subjectRef: id }
      });
      return { ...nothing, done: "exported", bundleId: bundle.id };
    }
    if (intent === "copilot") {
      const question = String(form.get("question") ?? "").trim();
      if (!question) return { ...nothing, error: "questionRequired" };
      const locale = String(form.get("locale") ?? "en");
      const result = await api<{ answer: string; confidence: number; mismatches: number[]; auditId: string }>(
        `/v1/axis/cases/${id}/copilot`,
        { env, request, method: "POST", body: { question, locale } }
      );
      return { ...nothing, done: "answered", answer: result.answer, confidence: result.confidence };
    }
    return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function CaseDetail() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale, shell?.overrides);
  const l = labelsIn(locale, shell?.domainPack);
  const busy = navigation.state !== "idle";
  const [copilotOpen, setCopilotOpen] = useState(false);

  if (!loaded.workItem) {
    return (
      <div className="flex flex-col gap-6">
        <Header title={l("colRef")} intro={l("intro")} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const workItem = loaded.workItem;

  const eventColumns: Array<Column<EventRow>> = [
    { key: "step", header: l("colStep"), render: (row) => <span className="font-ui text-12">{tag(l, "step", row.step)}</span> },
    {
      key: "outcome",
      header: l("colOutcome"),
      render: (row) => (row.outcome ? <Badge size="sm">{tag(l, "outcome", row.outcome)}</Badge> : <span>—</span>)
    },
    { key: "actorRef", header: l("colWho"), render: (row) => <span className="font-mono text-11">{row.actorRef}</span> },
    {
      key: "durationMs",
      header: l("colDuration"),
      numeric: true,
      render: (row) => <span className="font-mono text-11">{row.durationMs ?? "—"}</span>
    },
    { key: "ts", header: l("colWhen"), render: (row) => <DateTime value={row.ts} locale={locale} precision="minute" /> }
  ];

  const documentColumns: Array<Column<DocumentRow>> = [
    {
      key: "docType",
      header: l("colDocument"),
      render: (row) => <span className="font-ui text-12">{tag(l, "docType", row.docType)}</span>
    },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    {
      key: "extractionConfidence",
      header: l("colConfidence"),
      numeric: true,
      render: (row) => <span className="font-mono text-12">{row.extractionConfidence ?? "—"}</span>
    },
    {
      key: "verifiedAt",
      header: l("colVerified"),
      render: (row) =>
        row.verifiedAt ? (
          <DateTime value={row.verifiedAt} locale={locale} precision="day" />
        ) : loaded.may.verify ? (
          <Form method="post">
            <input type="hidden" name="intent" value="verify" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <input type="hidden" name="documentId" value={row.id} />
            <Button type="submit" size="sm" variant="ghost" loading={busy}>
              {l("verify")}
            </Button>
          </Form>
        ) : (
          <span>—</span>
        )
    }
  ];

  const approvalColumns: Array<Column<CaseApprovalRow>> = [
    { key: "policyKey", header: l("colPolicyKey"), render: (row) => <span className="font-mono text-11">{row.policyKey}</span> },
    {
      key: "decision",
      header: l("colOutcome"),
      render: (row) => <Badge size="sm">{tag(l, "decision", row.decision)}</Badge>
    },
    { key: "subjectRef", header: l("colSubject"), render: (row) => <span className="font-mono text-11">{row.subjectRef}</span> },
    { key: "ts", header: l("colWhen"), render: (row) => <DateTime value={row.ts} locale={locale} precision="minute" /> }
  ];

  const taskColumns: Array<Column<TaskRow>> = [
    { key: "titleKey", header: l("colTask"), render: (row) => <span className="font-ui text-12">{tag(l, "titleKey", row.titleKey)}</span> },
    { key: "state", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "state", row.state)}</Badge> },
    { key: "assigneeRef", header: l("colAssignee"), render: (row) => <span className="font-mono text-11">{row.assigneeRef ?? "—"}</span> },
    {
      key: "dueAt",
      header: l("colDue"),
      render: (row) => (row.dueAt ? <DateTime value={row.dueAt} locale={locale} precision="day" /> : <span>—</span>)
    }
  ];

  return (
    <>
    <div className="flex flex-col gap-6">
      <Header title={workItem.ref} intro={l("intro")} />

      <Link to="/axis/cases" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
        {l("back")}
      </Link>

      <Card
        title={l("standingTitle")}
        actions={
          <Badge size="sm" dot>
            {tag(l, "status", workItem.status)}
          </Badge>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat
            label={l("value")}
            value={
              workItem.valueMinor != null && workItem.currency ? (
                <Money amountMinor={workItem.valueMinor} currency={workItem.currency} locale={locale} />
              ) : (
                <span className="font-ui text-13">—</span>
              )
            }
          />
          <Stat
            label={l("sla")}
            value={
              workItem.slaDueAt ? (
                <DateTime value={workItem.slaDueAt} locale={locale} precision="minute" />
              ) : (
                <span className="font-ui text-13">—</span>
              )
            }
          />
          <Stat label={l("risk")} value={<span className="font-mono text-13">{workItem.riskScore ?? "—"}</span>} />
        </div>
        <Facts>
          <Entry term={l("kind")}>{tag(l, "kind", workItem.kind)}</Entry>
          <Entry term={l("priority")}>{tag(l, "priority", workItem.priority)}</Entry>
          <Entry term={l("source")}>{tag(l, "source", workItem.source)}</Entry>
          <Entry term={l("owner")}>{workItem.ownerRef ?? "—"}</Entry>
          <Entry term={l("team")}>{workItem.teamId ?? "—"}</Entry>
          <Entry term={l("productLine")}>{workItem.productLine ?? "—"}</Entry>
          <Entry term={l("holder")}>
            {workItem.customerId ? (
              <Link to={`/admin/customers/${workItem.customerId}/360`} className="text-accent hover:underline">
                {workItem.customerId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("channel")}>
            {workItem.channelId ? (
              <Link to={`/distribution/channels/${workItem.channelId}/detail`} className="text-accent hover:underline">
                {workItem.channelId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("quoteRequest")}>
            {workItem.quoteRequestId ? (
              <Link
                to={`/distribution/quote-requests/${workItem.quoteRequestId}/compare`}
                className="text-accent hover:underline"
              >
                {workItem.quoteRequestId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("closedAt")}>
            {workItem.closedAt ? <DateTime value={workItem.closedAt} locale={locale} precision="minute" /> : "—"}
          </Entry>
        </Facts>
      </Card>

      {loaded.may.update ? (
        <Card title={l("moveTitle")} description={l("moveIntro")}>
          <Form method="post" className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="intent" value="move" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <label className="flex flex-col gap-1 font-ui text-12 text-muted">
              {l("moveTo")}
              <Select
                name="status"
                defaultValue={workItem.status}
                options={STATES.map((value) => ({ value, label: tag(l, "status", value) }))}
              />
            </label>
            <Button type="submit" variant="primary" loading={busy}>
              {l("moveSubmit")}
            </Button>
          </Form>
        </Card>
      ) : null}

      {result?.error ? (
        <p role="alert" className="font-ui text-13 text-danger">
          {l(result.error)}
        </p>
      ) : null}
      {result?.done ? <p className="font-ui text-13 text-success">{l(result.done)}</p> : null}
      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}

      <Card title={l("eventsTitle")} padded={false}>
        <Table
          caption={l("eventsCaption")}
          columns={eventColumns}
          rows={loaded.events}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("documentsTitle")} padded={false}>
        <Table
          caption={l("documentsCaption")}
          columns={documentColumns}
          rows={loaded.documents}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("approvalsTitle")} padded={false}>
        <Table
          caption={l("approvalsCaption")}
          columns={approvalColumns}
          rows={loaded.approvals}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("tasksTitle")} padded={false}>
        <Table
          caption={l("tasksCaption")}
          columns={taskColumns}
          rows={loaded.tasks}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("metaTitle")}>
        <Payload value={workItem.metaJson} />
      </Card>

      {loaded.may.export ? (
        <Card title={l("exportTitle")} description={l("exportIntro")}>
          <Form method="post" className="flex flex-wrap items-center gap-4">
            <input type="hidden" name="intent" value="export" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <Button type="submit" variant="secondary" loading={busy}>
              {l("exportSubmit")}
            </Button>
            {result?.done === "exported" && result.bundleId ? (
              <a
                href={`/axis/cases/${workItem.id}/evidence-bundles/${result.bundleId}/download`}
                className="font-ui text-13 text-accent underline-offset-2 hover:underline"
              >
                {l("download")}
              </a>
            ) : null}
          </Form>
        </Card>
      ) : null}

      {loaded.may.copilot ? (
        // ponytail: AgentBadge has no `label` prop (only agent/why/size/className),
        // so the trigger's own text carries l("copilotTitle") and the badge just
        // supplies the single ✦ AI marker (docs/15 §4).
        <Button variant="secondary" onClick={() => setCopilotOpen(true)}>
          {l("copilotTitle")} <AgentBadge size="sm" />
        </Button>
      ) : null}
    </div>
      {loaded.may.copilot ? (
        <Drawer open={copilotOpen} onOpenChange={setCopilotOpen} title={l("copilotTitle")}>
          <Form method="post" replace>
            <input type="hidden" name="intent" value="copilot" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <input type="hidden" name="locale" value={locale} />
            <textarea name="question" placeholder={l("copilotPlaceholder")} rows={3} required />
            <Button type="submit" disabled={busy}>
              {l("copilotSubmit")}
            </Button>
          </Form>
          {result?.done === "answered" && result.answer ? (
            <>
              <GhostText text={result.answer} onAccept={() => {}} onDiscard={() => {}} />
              <ConfidenceMeter value={result.confidence ?? 0} />
            </>
          ) : (
            <p>{l("copilotEmpty")}</p>
          )}
        </Drawer>
      ) : null}
    </>
  );
}
