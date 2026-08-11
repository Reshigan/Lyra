import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Badge, Button, Card, DateTime, EmptyState, Money, Ref, Stat, Table, type Column } from "@lyra/ui";
import { api, fetchMe, names } from "../api.server";
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
import { useShellData } from "./workspace";

// One agreement: what it covers, what it costs, what has been claimed against
// it, the paper behind it, and its own version history. This screen writes
// nothing — every change to an agreement (endorse, cancel, renew) prices before
// it writes and lives on its own screen, so the read stays a read.

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

/** One row of `axis_policy_versions` — this contract's own history (F5). */
export interface VersionRow {
  id: string;
  versionSeq: number;
  endorsementNo?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  effectiveFrom: number;
  effectiveTo?: number | null;
  premiumMinor: number;
  premiumDeltaMinor: number;
  currency: string;
  state: string;
  issuedAt?: number | null;
  createdAt: number;
}

export const PERM = {
  read: "axis:policies:read",
  endorse: "axis:policies:endorse",
  cancel: "axis:policies:cancel",
  renew: "axis:policies:renew",
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
    historyCaption: "Every version of this agreement, newest first.",
    moneyTitle: "Commission trail",
    moneyCaption: "What this agreement earned, and any reversal against it.",
    documentsTitle: "Documents",
    documentsCaption: "Files filed against this agreement.",
    actionsTitle: "Change this agreement",
    actionsIntro:
      "Each of these prices before it writes, and each leaves a version behind. Nothing here edits this agreement in place.",
    endorseLink: "Endorse",
    cancelLink: "Cancel",
    renewLink: "Renew",
    colVersion: "Version",
    colReason: "Reason",
    colEffective: "Effective",
    colDelta: "Change",
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
    historyCaption: "كل إصدار من هذه الاتفاقية، الأحدث أولًا.",
    moneyTitle: "مسار العمولة",
    moneyCaption: "ما حققته هذه الاتفاقية، وأي عكس مسجّل عليها.",
    documentsTitle: "المستندات",
    documentsCaption: "الملفات المرفقة بهذه الاتفاقية.",
    actionsTitle: "تغيير هذه الاتفاقية",
    actionsIntro: "كل إجراء هنا يسعّر قبل أن يكتب، ويترك إصدارًا جديدًا. لا شيء منها يعدّل هذه الاتفاقية في مكانها.",
    endorseLink: "تعديل",
    cancelLink: "إلغاء",
    renewLink: "تجديد",
    colVersion: "الإصدار",
    colReason: "السبب",
    colEffective: "سريان",
    colDelta: "الفرق",
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
  const may = {
    read: held.has(PERM.read),
    endorse: held.has(PERM.endorse),
    cancel: held.has(PERM.cancel),
    renew: held.has(PERM.renew)
  };

  const empty = {
    policy: null as Policy | null,
    claims: [] as ClaimRow[],
    entries: [] as EntryRow[],
    documents: [] as FileRow[],
    versions: [] as VersionRow[],
    named: {} as Record<string, string>,
    may
  };

  if (!may.read) return empty;
  const policy = await safe(() => api<Policy>(`/v1/axis/policies/${id}`, options), null);
  if (!policy) return empty;

  const [claims, entries, documents, versions, named] = await Promise.all([
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
    // This agreement's own versions (F5). The old query asked for every other
    // contract the same holder owns, which is a different question entirely.
    safe(() => api<Page<VersionRow>>(`/v1/axis/policies/${id}/versions`, options), null),
    // Everything this agreement points at, named in one call: a person reads
    // "Amina Haddad", not `cu_01KE…`.
    names(
      [policy.customerId, policy.providerId, policy.productId, policy.channelId].filter(
        (ref): ref is string => Boolean(ref)
      ),
      options
    ).catch(() => ({}) as Record<string, string>)
  ]);

  return {
    ...empty,
    policy,
    claims: rowsOf(claims),
    entries: rowsOf(entries),
    documents: rowsOf(documents),
    versions: rowsOf(versions),
    named
  };
}

/* --------------------------------------------------------------- component */

export default function PolicyDetail() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const t = translator(locale, shell?.overrides);
  const l = labelsIn(locale, shell?.domainPack);

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

  const versionColumns: Array<Column<VersionRow>> = [
    {
      key: "versionSeq",
      header: l("colVersion"),
      render: (row) => (
        <span className="font-mono text-12 text-text">{row.endorsementNo ?? `#${row.versionSeq}`}</span>
      )
    },
    { key: "state", header: l("colStatus"), render: (row) => <Badge size="sm">{tag(l, "state", row.state)}</Badge> },
    {
      key: "reason",
      header: l("colReason"),
      render: (row) => <span className="font-ui text-12">{row.reason ?? tag(l, "reasonCode", row.reasonCode)}</span>
    },
    {
      key: "premiumMinor",
      header: l("premiumMinor"),
      numeric: true,
      render: (row) => <Money amountMinor={row.premiumMinor} currency={row.currency} locale={locale} />
    },
    {
      key: "premiumDeltaMinor",
      header: l("colDelta"),
      numeric: true,
      render: (row) => (
        <Money amountMinor={row.premiumDeltaMinor} currency={row.currency} locale={locale} signed toned />
      )
    },
    {
      key: "effectiveFrom",
      header: l("colEffective"),
      render: (row) => <DateTime value={row.effectiveFrom} locale={locale} precision="day" />
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
      render: (row) => <span className="font-mono text-12">{row.contentType ?? "—"}</span>
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
              {loaded.named[policy.customerId] ?? <Ref value={policy.customerId} />}
            </Link>
          </Entry>
          <Entry term={l("provider")}>{loaded.named[policy.providerId] ?? <Ref value={policy.providerId} />}</Entry>
          <Entry term={l("product")}>
            {policy.productId ? (
              <Link to={`/admin/products/${policy.productId}/detail`} className="text-accent hover:underline">
                {loaded.named[policy.productId] ?? <Ref value={policy.productId} />}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("offering")}>{policy.offeringId ? <Ref value={policy.offeringId} /> : "—"}</Entry>
          <Entry term={l("channel")}>
            {policy.channelId ? (
              <Link to={`/distribution/channels/${policy.channelId}/detail`} className="text-accent hover:underline">
                {loaded.named[policy.channelId] ?? <Ref value={policy.channelId} />}
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("caseRef")}>
            {policy.caseId ? (
              <Link to={`/axis/cases/${policy.caseId}/detail`} className="text-accent hover:underline">
                <Ref value={policy.caseId} />
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("escrow")}>{policy.escrowBatchId ? <Ref value={policy.escrowBatchId} /> : "—"}</Entry>
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

      {loaded.may.endorse || loaded.may.cancel || loaded.may.renew ? (
        <Card title={l("actionsTitle")} description={l("actionsIntro")}>
          <div className="flex flex-wrap gap-3">
            {loaded.may.endorse ? (
              <Button asChild variant="primary">
                <Link to={`/axis/policies/${policy.id}/endorse`}>{l("endorseLink")}</Link>
              </Button>
            ) : null}
            {loaded.may.cancel ? (
              <Button asChild variant="ghost">
                <Link to={`/axis/policies/${policy.id}/cancel`}>{l("cancelLink")}</Link>
              </Button>
            ) : null}
            {loaded.may.renew ? (
              <Button asChild variant="ghost">
                <Link to="/axis/renewals">{l("renewLink")}</Link>
              </Button>
            ) : null}
          </div>
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
