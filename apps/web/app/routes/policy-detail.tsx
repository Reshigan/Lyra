import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Badge, Button, Card, DateTime, EmptyState, Input, Money, Stat, Table, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import {
  Entry,
  Facts,
  Header,
  Payload,
  labelsFrom,
  rowsOf,
  safe,
  tag,
  type Page
} from "./detail-kit";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// One agreement: what it covers, what it costs, what has been claimed against
// it, the paper behind it, and the one write this screen owns — an endorsement,
// which is a new priced agreement and therefore goes through `axis.bind`
// approval rather than editing the row in place (CLAUDE.md §12).

/* --------------------------------------------------------------- contract */

export interface Policy {
  id: string;
  caseId?: string | null;
  customerId: string;
  providerId: string;
  productId?: string | null;
  offeringId?: string | null;
  channelId?: string | null;
  policyNo: string;
  startAt: number;
  endAt: number;
  premiumMinor: number;
  currency: string;
  commissionMinor: number;
  docsJson?: unknown;
  escrowBatchId?: string | null;
  paymentPlanJson?: unknown;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClaimRow {
  id: string;
  claimNo: string;
  status: string;
  incidentAt: number;
  amountMinor?: number | null;
  settledMinor?: number | null;
  currency: string;
}

export interface EntryRow {
  id: string;
  kind: string;
  premiumMinor: number;
  grossCommissionMinor: number;
  netCommissionMinor: number;
  currency: string;
  earnedAt?: number | null;
  state: string;
}

export interface FileRow {
  id: string;
  kind: string;
  contentType?: string | null;
  piiLevel: string;
  createdAt: number;
}

export const PERM = {
  read: "axis:policies:read",
  endorse: "axis:policies:create",
  claims: "axis:claims:read",
  commissions: "dist:commissions:read",
  files: "core:files:read"
} as const;

/* ---------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    intro: "What is covered, what it costs, what has been claimed against it, and the paper behind it.",
    back: "Back to the register",
    coverTitle: "The agreement",
    term: "Term",
    holder: "Held by",
    provider: "Underwritten by",
    product: "Product",
    offering: "Variant",
    channel: "Sold through",
    caseRef: "Work item",
    commission: "Commission",
    escrow: "Escrow batch",
    paymentPlanTitle: "Payment plan",
    docsTitle: "Schedule and wording",
    claimsCaption: "Every claim reported against this agreement.",
    historyTitle: "Endorsement history",
    historyCaption: "Every version issued for this holder, newest first.",
    moneyTitle: "Commission trail",
    moneyCaption: "What this agreement earned, and any reversal against it.",
    documentsTitle: "Documents",
    documentsCaption: "Files filed against this agreement.",
    endorseTitle: "Endorse",
    endorseIntro:
      "An endorsement issues a new priced version. It does not change this one, and it needs the same sign-off as a new sale.",
    newRef: "New reference",
    newPremium: "New premium, in minor units",
    newEnd: "New expiry",
    endorseSubmit: "Request the endorsement",
    endorsed: "The endorsement was issued.",
    refRequired: "Give the new version its own reference.",
    refSame: "That is this version's reference. An endorsement needs a new one.",
    premiumRequired: "Enter the new premium as a whole number above zero.",
    endRequired: "Pick the new expiry date.",
    colClaimAmount: "Claimed",
    colSettled: "Settled",
    colIncident: "Incident",
    colEarnedAt: "Earned",
    colGross: "Gross",
    colNet: "Net",
    colFormat: "Format",
    colFiled: "Filed"
  },
  ar: {
    intro: "ما هو مغطّى، وتكلفته، والمطالبات المسجّلة عليه، والمستندات المرتبطة به.",
    back: "العودة إلى السجل",
    coverTitle: "الاتفاقية",
    term: "المدة",
    holder: "صاحب التغطية",
    provider: "جهة الاكتتاب",
    product: "المنتج",
    offering: "الصيغة",
    channel: "قناة البيع",
    caseRef: "بند العمل",
    commission: "العمولة",
    escrow: "دفعة الضمان",
    paymentPlanTitle: "خطة السداد",
    docsTitle: "الجدول والصيغة",
    claimsCaption: "كل مطالبة مسجّلة على هذه الاتفاقية.",
    historyTitle: "سجل التعديلات",
    historyCaption: "كل إصدار لهذا العميل، الأحدث أولًا.",
    moneyTitle: "مسار العمولة",
    moneyCaption: "ما حققته هذه الاتفاقية، وأي عكس مسجّل عليها.",
    documentsTitle: "المستندات",
    documentsCaption: "الملفات المرفقة بهذه الاتفاقية.",
    endorseTitle: "تعديل",
    endorseIntro: "التعديل يصدر إصدارًا جديدًا بسعر جديد. لا يغيّر هذا الإصدار، ويحتاج الاعتماد نفسه كأي بيع جديد.",
    newRef: "المرجع الجديد",
    newPremium: "القسط الجديد بالوحدات الصغرى",
    newEnd: "تاريخ الانتهاء الجديد",
    endorseSubmit: "طلب التعديل",
    endorsed: "تم إصدار التعديل.",
    refRequired: "أدخل مرجعًا خاصًا بالإصدار الجديد.",
    refSame: "هذا مرجع الإصدار الحالي. التعديل يحتاج مرجعًا جديدًا.",
    premiumRequired: "أدخل القسط الجديد كرقم صحيح أكبر من صفر.",
    endRequired: "اختر تاريخ الانتهاء الجديد.",
    colClaimAmount: "المطلوب",
    colSettled: "المسدد",
    colIncident: "تاريخ الحادث",
    colEarnedAt: "تاريخ التحقق",
    colGross: "الإجمالي",
    colNet: "الصافي",
    colFormat: "الصيغة",
    colFiled: "تاريخ الإيداع"
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
  const may = { read: held.has(PERM.read), endorse: held.has(PERM.endorse) };

  const empty = {
    policy: null as Policy | null,
    claims: [] as ClaimRow[],
    entries: [] as EntryRow[],
    documents: [] as FileRow[],
    versions: [] as Policy[],
    may,
    idempotencyKey: crypto.randomUUID()
  };

  if (!may.read) return empty;
  const policy = await safe(() => api<Policy>(`/v1/axis/policies/${id}`, options), null);
  if (!policy) return empty;

  // The holder is only known once the agreement is read, so the sibling-version
  // panel waits for it. Everything else fans out.
  const [claims, entries, documents, versions] = await Promise.all([
    held.has(PERM.claims)
      ? safe(() => api<Page<ClaimRow>>(`/v1/axis/claims?policyId=${id}&limit=50`, options), null)
      : null,
    held.has(PERM.commissions)
      ? safe(() => api<Page<EntryRow>>(`/v1/dist/commission-entries?policyId=${id}&limit=50`, options), null)
      : null,
    held.has(PERM.files)
      ? safe(
          () =>
            api<Page<FileRow>>(
              `/v1/core/files?subjectRef=${encodeURIComponent(`policies:${id}`)}&limit=50`,
              options
            ),
          null
        )
      : null,
    safe(
      () =>
        api<Page<Policy>>(
          `/v1/axis/policies?customerId=${encodeURIComponent(policy.customerId)}&sort=createdAt&order=desc&limit=25`,
          options
        ),
      null
    )
  ]);

  return {
    ...empty,
    policy,
    claims: rowsOf(claims),
    entries: rowsOf(entries),
    documents: rowsOf(documents),
    versions: rowsOf(versions)
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const nothing = { done: null as string | null, problem: null as Problem | null, error: null as string | null };

  if (intent !== "endorse") {
    return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  }

  const policyNo = String(form.get("policyNo") ?? "").trim();
  const basePolicyNo = String(form.get("basePolicyNo") ?? "").trim();
  if (!policyNo) return { ...nothing, error: "refRequired" };
  if (policyNo === basePolicyNo) return { ...nothing, error: "refSame" };

  const premiumMinor = Number(form.get("premiumMinor"));
  if (!Number.isInteger(premiumMinor) || premiumMinor <= 0) return { ...nothing, error: "premiumRequired" };

  const endAt = Date.parse(String(form.get("endAt") ?? ""));
  if (!Number.isFinite(endAt)) return { ...nothing, error: "endRequired" };

  const optional = (name: string) => {
    const value = String(form.get(name) ?? "").trim();
    return value ? { [name]: value } : {};
  };

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    // A new priced version, not an edit: `axis.bind` gates it and a 403 with
    // `approval_required` is the expected answer, not a failure to hide.
    await api<Policy>("/v1/axis/policies", {
      env,
      request,
      method: "POST",
      ...(key ? { headers: { "idempotency-key": key } } : {}),
      body: {
        customerId: String(form.get("customerId") ?? ""),
        providerId: String(form.get("providerId") ?? ""),
        policyNo,
        premiumMinor,
        currency: String(form.get("currency") ?? ""),
        startAt: Number(form.get("startAt")),
        endAt,
        ...optional("caseId"),
        ...optional("productId"),
        ...optional("offeringId"),
        ...optional("channelId")
      }
    });
    return { ...nothing, done: "endorsed" };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function PolicyDetail() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale, shell?.overrides);
  const l = labelsIn(locale, shell?.domainPack);
  const busy = navigation.state !== "idle";

  if (!loaded.policy) {
    return (
      <div className="flex flex-col gap-6">
        <Header title={l("policyId")} intro={l("intro")} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const policy = loaded.policy;

  const claimColumns: Array<Column<ClaimRow>> = [
    {
      key: "claimNo",
      header: l("claimNo"),
      render: (row) => (
        <Link to={`/axis/claims/${row.id}/detail`} className="font-mono text-12 text-accent hover:underline">
          {row.claimNo}
        </Link>
      )
    },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    {
      key: "incidentAt",
      header: l("colIncident"),
      render: (row) => <DateTime value={row.incidentAt} locale={locale} precision="day" />
    },
    {
      key: "amountMinor",
      header: l("colClaimAmount"),
      numeric: true,
      render: (row) => <Money amountMinor={row.amountMinor ?? 0} currency={row.currency} locale={locale} />
    },
    {
      key: "settledMinor",
      header: l("colSettled"),
      numeric: true,
      render: (row) => <Money amountMinor={row.settledMinor ?? 0} currency={row.currency} locale={locale} />
    }
  ];

  const versionColumns: Array<Column<Policy>> = [
    {
      key: "policyNo",
      header: l("policyNo"),
      render: (row) =>
        row.id === policy.id ? (
          <span className="font-mono text-12 text-text">{row.policyNo}</span>
        ) : (
          <Link to={`/axis/policies/${row.id}/detail`} className="font-mono text-12 text-accent hover:underline">
            {row.policyNo}
          </Link>
        )
    },
    { key: "status", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "status", row.status)}</Badge> },
    {
      key: "premiumMinor",
      header: l("premiumMinor"),
      numeric: true,
      render: (row) => <Money amountMinor={row.premiumMinor} currency={row.currency} locale={locale} />
    },
    {
      key: "endAt",
      header: l("term"),
      render: (row) => <DateTime value={row.endAt} locale={locale} precision="day" />
    },
    {
      key: "createdAt",
      header: l("colCreated"),
      render: (row) => <DateTime value={row.createdAt} locale={locale} precision="day" />
    }
  ];

  const entryColumns: Array<Column<EntryRow>> = [
    { key: "kind", header: l("colKind"), render: (row) => <span className="font-ui text-12">{tag(l, "kind", row.kind)}</span> },
    { key: "state", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "state", row.state)}</Badge> },
    {
      key: "grossCommissionMinor",
      header: l("colGross"),
      numeric: true,
      render: (row) => <Money amountMinor={row.grossCommissionMinor} currency={row.currency} locale={locale} signed toned />
    },
    {
      key: "netCommissionMinor",
      header: l("colNet"),
      numeric: true,
      render: (row) => <Money amountMinor={row.netCommissionMinor} currency={row.currency} locale={locale} signed toned />
    },
    {
      key: "earnedAt",
      header: l("colEarnedAt"),
      render: (row) =>
        row.earnedAt ? <DateTime value={row.earnedAt} locale={locale} precision="day" /> : <span>—</span>
    }
  ];

  const fileColumns: Array<Column<FileRow>> = [
    { key: "kind", header: l("colDocument"), render: (row) => <span className="font-ui text-12">{tag(l, "kind", row.kind)}</span> },
    {
      key: "contentType",
      header: l("colFormat"),
      render: (row) => <span className="font-mono text-11">{row.contentType ?? "—"}</span>
    },
    {
      key: "piiLevel",
      header: l("colSensitivity"),
      render: (row) => <Badge size="sm">{tag(l, "piiLevel", row.piiLevel)}</Badge>
    },
    {
      key: "createdAt",
      header: l("colFiled"),
      render: (row) => <DateTime value={row.createdAt} locale={locale} precision="day" />
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <Header title={`${l("policyId")} ${policy.policyNo}`} intro={l("intro")} />

      <Link to="/axis/policies" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
        {l("back")}
      </Link>

      <Card
        title={l("coverTitle")}
        actions={
          <Badge size="sm" dot>
            {tag(l, "status", policy.status)}
          </Badge>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-3">
          <Stat
            label={l("premiumMinor")}
            value={<Money amountMinor={policy.premiumMinor} currency={policy.currency} locale={locale} />}
          />
          <Stat
            label={l("commission")}
            value={<Money amountMinor={policy.commissionMinor} currency={policy.currency} locale={locale} />}
          />
          <Stat
            label={l("term")}
            value={
              <span className="font-ui text-13">
                <DateTime value={policy.startAt} locale={locale} precision="day" />
                {" — "}
                <DateTime value={policy.endAt} locale={locale} precision="day" />
              </span>
            }
          />
        </div>
        <Facts>
          <Entry term={l("holder")}>
            <Link to={`/admin/customers/${policy.customerId}/360`} className="text-accent hover:underline">
              {policy.customerId}
            </Link>
          </Entry>
          <Entry term={l("provider")}>{policy.providerId}</Entry>
          <Entry term={l("product")}>
            {policy.productId ? (
              <Link to={`/admin/products/${policy.productId}/detail`} className="text-accent hover:underline">
                {policy.productId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("offering")}>{policy.offeringId ?? "—"}</Entry>
          <Entry term={l("channel")}>
            {policy.channelId ? (
              <Link to={`/distribution/channels/${policy.channelId}/detail`} className="text-accent hover:underline">
                {policy.channelId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("caseRef")}>
            {policy.caseId ? (
              <Link to={`/axis/cases/${policy.caseId}/detail`} className="text-accent hover:underline">
                {policy.caseId}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("escrow")}>{policy.escrowBatchId ?? "—"}</Entry>
        </Facts>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={l("docsTitle")}>
          <Payload value={policy.docsJson} />
        </Card>
        <Card title={l("paymentPlanTitle")}>
          <Payload value={policy.paymentPlanJson} />
        </Card>
      </div>

      {loaded.may.endorse ? (
        <Card title={l("endorseTitle")} description={l("endorseIntro")}>
          <Form method="post" className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="intent" value="endorse" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <input type="hidden" name="basePolicyNo" value={policy.policyNo} />
            <input type="hidden" name="customerId" value={policy.customerId} />
            <input type="hidden" name="providerId" value={policy.providerId} />
            <input type="hidden" name="currency" value={policy.currency} />
            <input type="hidden" name="startAt" value={policy.startAt} />
            <input type="hidden" name="caseId" value={policy.caseId ?? ""} />
            <input type="hidden" name="productId" value={policy.productId ?? ""} />
            <input type="hidden" name="offeringId" value={policy.offeringId ?? ""} />
            <input type="hidden" name="channelId" value={policy.channelId ?? ""} />
            <label className="flex flex-col gap-1 font-ui text-12 text-muted">
              {l("newRef")}
              <Input name="policyNo" defaultValue={`${policy.policyNo}-E`} required className="w-56" />
            </label>
            <label className="flex flex-col gap-1 font-ui text-12 text-muted">
              {l("newPremium")}
              <Input
                name="premiumMinor"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                defaultValue={policy.premiumMinor}
                required
                className="w-40"
              />
            </label>
            <label className="flex flex-col gap-1 font-ui text-12 text-muted">
              {l("newEnd")}
              <Input name="endAt" type="date" required className="w-44" />
            </label>
            <Button type="submit" variant="primary" loading={busy}>
              {l("endorseSubmit")}
            </Button>
          </Form>
          {result?.error ? (
            <p role="alert" className="mt-3 font-ui text-13 text-danger">
              {l(result.error)}
            </p>
          ) : null}
          {result?.done ? <p className="mt-3 font-ui text-13 text-success">{l(result.done)}</p> : null}
          {result?.problem ? <Gate problem={result.problem} l={l} /> : null}
        </Card>
      ) : null}

      <Card title={l("claims")} padded={false}>
        <Table
          caption={l("claimsCaption")}
          columns={claimColumns}
          rows={loaded.claims}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("historyTitle")} padded={false}>
        <Table
          caption={l("historyCaption")}
          columns={versionColumns}
          rows={loaded.versions}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("moneyTitle")} padded={false}>
        <Table
          caption={l("moneyCaption")}
          columns={entryColumns}
          rows={loaded.entries}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("documentsTitle")} padded={false}>
        <Table
          caption={l("documentsCaption")}
          columns={fileColumns}
          rows={loaded.documents}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>
    </div>
  );
}
