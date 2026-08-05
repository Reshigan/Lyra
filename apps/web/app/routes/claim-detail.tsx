import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  Input,
  Money,
  Select,
  Stat,
  Table,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { Entry, Facts, Header, Payload, labelsFrom, rowsOf, safe, tag, type Page } from "./detail-kit";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// One claim: what was reported, what it is reserved at, the paper behind it, and
// the two writes that move it — an assessment and a settlement. Both go through
// the `axis.claim_settlement` gate (apps/api/src/resources.ts), so both surface
// the approval path instead of pretending the write landed (CLAUDE.md §4, §12).

/* --------------------------------------------------------------- contract */

export interface Claim {
  id: string;
  policyId: string;
  customerId: string;
  caseId?: string | null;
  claimNo: string;
  incidentAt?: number | null;
  reportedAt: number;
  amountMinor?: number | null;
  settledMinor?: number | null;
  currency: string;
  status: string;
  fnolJson?: unknown;
  assessorRef?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyRef {
  id: string;
  policyNo: string;
  status: string;
  premiumMinor: number;
  currency: string;
  startAt: number;
  endAt: number;
}

export interface DocumentRow {
  id: string;
  docType: string;
  status: string;
  extractionConfidence?: number | null;
  verifiedAt?: number | null;
  createdAt: number;
}

export interface ApprovalRow {
  id: string;
  policyKey: string;
  decision: string;
  requestedBy: string;
  requestedAt: number;
  decidedAt?: number | null;
  reason?: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  actorRef: string;
  ts: number;
}

export const PERM = {
  read: "axis:claims:read",
  update: "axis:claims:update",
  policy: "axis:policies:read",
  documents: "axis:documents:read",
  approvals: "core:approvals:read",
  audit: "core:audit:read"
} as const;

/** The transitions an assessor owns. Settlement is its own, gated, intent. */
export const ASSESSMENTS = ["assessing", "approved", "rejected"] as const;

/* ---------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    intro: "What was reported, what it is reserved at, the paper behind it, and who signed off.",
    back: "Back to the register",
    fnolTitle: "First notice",
    fnolCaption: "The report as it was taken, unedited.",
    summaryTitle: "The claim",
    reserved: "Reserved",
    settled: "Settled",
    reportedAt: "Reported",
    incidentAt: "Incident",
    assessor: "Assessor",
    holder: "Claimant",
    against: "Claimed against",
    caseRef: "Work item",
    assessTitle: "Assessment",
    assessIntro: "Record where the assessment stands. Every change to a claim needs the same sign-off as a payment.",
    outcome: "Outcome",
    reserve: "Revised reserve, in minor units",
    assessSubmit: "Record the assessment",
    assessed: "The assessment was recorded.",
    outcomeRequired: "Choose an outcome.",
    settleTitle: "Settlement",
    settleIntro: "A settlement pays the claimant. It is held until it is approved, and it is never paid from this screen.",
    settleAmount: "Amount to settle, in minor units",
    settleSubmit: "Request the settlement",
    settleDone: "The settlement was recorded.",
    settleRequired: "Enter the settlement as a whole number above zero.",
    documentsTitle: "Documents",
    documentsCaption: "Evidence filed on the work item behind this claim.",
    approvalsTitle: "Sign-off",
    approvalsCaption: "Every approval raised against this claim.",
    historyTitle: "Trail",
    historyCaption: "Every change recorded against this claim, newest first.",
    colConfidence: "Confidence",
    colVerified: "Verified",
    colPolicyKey: "Rule",
    colReason: "Note",
    colAction: "Change",
    noPolicy: "You can't see the cover this claim sits on.",
    noCase: "No work item is attached, so there is no evidence to show."
  },
  ar: {
    intro: "ما تم الإبلاغ عنه، والمبلغ المحتجز، والمستندات المرتبطة، ومن اعتمده.",
    back: "العودة إلى السجل",
    fnolTitle: "الإشعار الأول",
    fnolCaption: "البلاغ كما استُلم، دون تعديل.",
    summaryTitle: "المطالبة",
    reserved: "المحتجز",
    settled: "المسدد",
    reportedAt: "تاريخ الإبلاغ",
    incidentAt: "تاريخ الحادث",
    assessor: "المُقيّم",
    holder: "المطالِب",
    against: "مقدّمة على",
    caseRef: "بند العمل",
    assessTitle: "التقييم",
    assessIntro: "سجّل موقف التقييم. كل تغيير على المطالبة يحتاج الاعتماد نفسه المطلوب للدفع.",
    outcome: "النتيجة",
    reserve: "المبلغ المحتجز المعدّل بالوحدات الصغرى",
    assessSubmit: "تسجيل التقييم",
    assessed: "تم تسجيل التقييم.",
    outcomeRequired: "اختر نتيجة.",
    settleTitle: "التسوية",
    settleIntro: "التسوية تدفع للمطالِب. تبقى معلّقة حتى الاعتماد، ولا تُدفع من هذه الشاشة.",
    settleAmount: "مبلغ التسوية بالوحدات الصغرى",
    settleSubmit: "طلب التسوية",
    settleDone: "تم تسجيل التسوية.",
    settleRequired: "أدخل مبلغ التسوية كرقم صحيح أكبر من صفر.",
    documentsTitle: "المستندات",
    documentsCaption: "الأدلة المرفقة ببند العمل الخاص بهذه المطالبة.",
    approvalsTitle: "الاعتماد",
    approvalsCaption: "كل موافقة طُلبت على هذه المطالبة.",
    historyTitle: "السجل",
    historyCaption: "كل تغيير مسجّل على هذه المطالبة، الأحدث أولًا.",
    colConfidence: "درجة الثقة",
    colVerified: "تاريخ التوثيق",
    colPolicyKey: "القاعدة",
    colReason: "ملاحظة",
    colAction: "التغيير",
    noPolicy: "لا يمكنك الاطلاع على التغطية المرتبطة بهذه المطالبة.",
    noCase: "لا يوجد بند عمل مرتبط، لذا لا توجد أدلة لعرضها."
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
  const may = { read: held.has(PERM.read), update: held.has(PERM.update) };

  const empty = {
    claim: null as Claim | null,
    policy: null as PolicyRef | null,
    documents: [] as DocumentRow[],
    approvals: [] as ApprovalRow[],
    trail: [] as AuditRow[],
    may,
    idempotencyKey: crypto.randomUUID()
  };

  if (!may.read) return empty;
  const claim = await safe(() => api<Claim>(`/v1/axis/claims/${id}`, options), null);
  if (!claim) return empty;

  // Evidence hangs off the work item, not the claim, so that read needs the
  // claim first. The rest of the fan-out is independent.
  const [policy, documents, approvals, trail] = await Promise.all([
    held.has(PERM.policy) ? safe(() => api<PolicyRef>(`/v1/axis/policies/${claim.policyId}`, options), null) : null,
    held.has(PERM.documents) && claim.caseId
      ? safe(
          () => api<Page<DocumentRow>>(`/v1/axis/documents?caseId=${encodeURIComponent(claim.caseId!)}&limit=50`, options),
          null
        )
      : null,
    held.has(PERM.approvals)
      ? safe(
          () =>
            api<Page<ApprovalRow>>(
              `/v1/core/approvals?subjectRef=${encodeURIComponent(`claims:${id}`)}&limit=25`,
              options
            ),
          null
        )
      : null,
    held.has(PERM.audit)
      ? safe(
          () =>
            api<Page<AuditRow>>(
              `/v1/core/audit-log?subjectRef=${encodeURIComponent(id)}&sort=ts&order=desc&limit=25`,
              options
            ),
          null
        )
      : null
  ]);

  return {
    ...empty,
    claim,
    policy,
    documents: rowsOf(documents),
    approvals: rowsOf(approvals),
    trail: rowsOf(trail)
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id ?? String(form.get("id") ?? "");
  const nothing = { done: null as string | null, problem: null as Problem | null, error: null as string | null };

  let body: Record<string, unknown>;
  if (intent === "assess") {
    const status = String(form.get("status") ?? "");
    if (!(ASSESSMENTS as readonly string[]).includes(status)) return { ...nothing, error: "outcomeRequired" };
    const raw = String(form.get("amountMinor") ?? "").trim();
    const amountMinor = raw === "" ? null : Number(raw);
    if (amountMinor !== null && (!Number.isInteger(amountMinor) || amountMinor < 0)) {
      return { ...nothing, error: "settleRequired" };
    }
    body = { status, ...(amountMinor === null ? {} : { amountMinor }) };
  } else if (intent === "settle") {
    const settledMinor = Number(form.get("settledMinor"));
    if (!Number.isInteger(settledMinor) || settledMinor <= 0) return { ...nothing, error: "settleRequired" };
    body = { settledMinor, status: "settled" };
  } else {
    return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  }

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    // Every update to a claim is gated by `axis.claim_settlement`; a 403 with
    // `approval_required` is the normal answer here, not an error to hide.
    // `assess` and `settle` both PATCH this same route from the one
    // loader-minted key, so the key is suffixed with the intent — otherwise a
    // same-page assess-then-settle reuses the key with a different body and
    // 409s (see case-detail.tsx's identical suffixing for the same reason).
    await api<Claim>(`/v1/axis/claims/${id}`, {
      env,
      request,
      method: "PATCH",
      ...(key ? { headers: { "idempotency-key": `${key}:${intent}` } } : {}),
      body
    });
    return { ...nothing, done: intent === "settle" ? "settleDone" : "assessed" };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function ClaimDetail() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale, shell?.overrides);
  const l = labelsIn(locale, shell?.domainPack);
  const busy = navigation.state !== "idle";

  if (!loaded.claim) {
    return (
      <div className="flex flex-col gap-6">
        <Header title={l("claimNo")} intro={l("intro")} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const claim = loaded.claim;

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
      render: (row) => (row.verifiedAt ? <DateTime value={row.verifiedAt} locale={locale} precision="day" /> : <span>—</span>)
    }
  ];

  const approvalColumns: Array<Column<ApprovalRow>> = [
    { key: "policyKey", header: l("colPolicyKey"), render: (row) => <span className="font-mono text-11">{row.policyKey}</span> },
    {
      key: "decision",
      header: l("colOutcome"),
      render: (row) => <Badge size="sm">{tag(l, "decision", row.decision)}</Badge>
    },
    { key: "requestedBy", header: l("colWho"), render: (row) => <span className="font-mono text-11">{row.requestedBy}</span> },
    {
      key: "requestedAt",
      header: l("colWhen"),
      render: (row) => <DateTime value={row.requestedAt} locale={locale} precision="minute" />
    },
    { key: "reason", header: l("colReason"), render: (row) => <span className="font-ui text-12">{row.reason ?? "—"}</span> }
  ];

  const trailColumns: Array<Column<AuditRow>> = [
    { key: "action", header: l("colAction"), render: (row) => <span className="font-mono text-11">{row.action}</span> },
    { key: "actorRef", header: l("colWho"), render: (row) => <span className="font-mono text-11">{row.actorRef}</span> },
    { key: "ts", header: l("colWhen"), render: (row) => <DateTime value={row.ts} locale={locale} precision="minute" /> }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header title={`${l("claimNo")} ${claim.claimNo}`} intro={l("intro")} />

      <Link to="/axis/claims" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
        {l("back")}
      </Link>

      <Card
        title={l("summaryTitle")}
        actions={
          <Badge size="sm" dot>
            {tag(l, "status", claim.status)}
          </Badge>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat
            label={l("reserved")}
            value={<Money amountMinor={claim.amountMinor ?? 0} currency={claim.currency} locale={locale} />}
          />
          <Stat
            label={l("settled")}
            value={<Money amountMinor={claim.settledMinor ?? 0} currency={claim.currency} locale={locale} />}
          />
          <Stat label={l("reportedAt")} value={<DateTime value={claim.reportedAt} locale={locale} precision="day" />} />
        </div>
        <Facts>
          <Entry term={l("incidentAt")}>
            {claim.incidentAt ? <DateTime value={claim.incidentAt} locale={locale} precision="day" /> : "—"}
          </Entry>
          <Entry term={l("holder")}>
            <Link to={`/admin/customers/${claim.customerId}/360`} className="text-accent hover:underline">
              {claim.customerId}
            </Link>
          </Entry>
          <Entry term={l("against")}>
            {loaded.policy ? (
              <Link to={`/axis/policies/${claim.policyId}/detail`} className="text-accent hover:underline">
                {loaded.policy.policyNo}
              </Link>
            ) : (
              l("noPolicy")
            )}
          </Entry>
          <Entry term={l("caseRef")}>
            {claim.caseId ? (
              <Link to={`/axis/cases/${claim.caseId}/detail`} className="text-accent hover:underline">
                {claim.caseId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("assessor")}>{claim.assessorRef ?? "—"}</Entry>
        </Facts>
      </Card>

      <Card title={l("fnolTitle")} description={l("fnolCaption")}>
        <Payload value={claim.fnolJson} />
      </Card>

      {loaded.may.update ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title={l("assessTitle")} description={l("assessIntro")}>
            <Form method="post" className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="intent" value="assess" />
              <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("outcome")}
                <Select
                  name="status"
                  defaultValue={claim.status}
                  options={ASSESSMENTS.map((value) => ({ value, label: tag(l, "status", value) }))}
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("reserve")}
                <Input
                  name="amountMinor"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  defaultValue={claim.amountMinor ?? undefined}
                  className="w-40"
                />
              </label>
              <Button type="submit" loading={busy}>
                {l("assessSubmit")}
              </Button>
            </Form>
          </Card>

          <Card title={l("settleTitle")} description={l("settleIntro")}>
            <Form method="post" className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="intent" value="settle" />
              <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("settleAmount")}
                <Input
                  name="settledMinor"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={claim.settledMinor ?? claim.amountMinor ?? undefined}
                  required
                  className="w-40"
                />
              </label>
              <Button type="submit" variant="primary" loading={busy}>
                {l("settleSubmit")}
              </Button>
            </Form>
          </Card>
        </div>
      ) : null}

      {result?.error ? (
        <p role="alert" className="font-ui text-13 text-danger">
          {l(result.error)}
        </p>
      ) : null}
      {result?.done ? <p className="font-ui text-13 text-success">{l(result.done)}</p> : null}
      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}

      <Card title={l("documentsTitle")} padded={false}>
        <Table
          caption={l("documentsCaption")}
          columns={documentColumns}
          rows={loaded.documents}
          rowKey={(row) => row.id}
          empty={<EmptyState title={claim.caseId ? l("none") : l("noCase")} />}
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

      <Card title={l("historyTitle")} padded={false}>
        <Table
          caption={l("historyCaption")}
          columns={trailColumns}
          rows={loaded.trail}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>
    </div>
  );
}
