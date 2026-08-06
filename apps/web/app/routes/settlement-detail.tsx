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
  Checkbox,
  EmptyState,
  Field,
  Money,
  Table,
  Textarea,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import {
  Gate,
  PERM,
  reasonError,
  settlementTone,
  transitionsFor,
  type Settlement,
  type Transition
} from "./settlement";

// One settlement's remittance advice: the entries it was drafted from, the
// terms that priced it, and whichever of approve/pay/dispute/reopen the
// actor's two grants (dist:commissions:settle, ledger:payouts:approve) still
// leave open (docs/19 §5).

/* --------------------------------------------------------------- contract */

export interface LineColumn {
  key: string;
  label: string;
  kind: "text" | "money";
}

export interface LinesPayload {
  settlement: Settlement;
  table: {
    title: string;
    columns: LineColumn[];
    rows: Array<Record<string, string | number>>;
    currency: string;
    generatedAt: number;
  };
  totals: { grossMinor: number; adjustmentsMinor: number; netMinor: number };
  terms: { minPayoutMinor: number; agreementId: string | null; agreementVersion: number | null };
}

/* ---------------------------------------------------------------- helpers */

/** Splits a statement's channel-commission lines into this period vs. carried in. */
export function lineSums(
  table: LinesPayload["table"],
  period?: string
): {
  premiumMinor: number;
  grossCommissionMinor: number;
  channelCommissionMinor: number;
  periodMinor: number;
  carriedInMinor: number;
} {
  let premiumMinor = 0;
  let grossCommissionMinor = 0;
  let channelCommissionMinor = 0;
  let periodMinor = 0;
  let carriedInMinor = 0;
  for (const row of table.rows) {
    premiumMinor += Number(row.premiumMinor ?? 0);
    grossCommissionMinor += Number(row.grossCommissionMinor ?? 0);
    const share = Number(row.channelCommissionMinor ?? 0);
    channelCommissionMinor += share;
    const bucket = String(row.bucket ?? "");
    const carriedIn = period ? bucket !== period : bucket === "carried in";
    if (carriedIn) carriedInMinor += share;
    else periodMinor += share;
  }
  return { premiumMinor, grossCommissionMinor, channelCommissionMinor, periodMinor, carriedInMinor };
}

/** The ledger invariant (CLAUDE.md §12), checked client-side before it is shown as fact. */
export function netHolds(totals: { grossMinor: number; adjustmentsMinor: number; netMinor: number }): boolean {
  return totals.grossMinor + totals.adjustmentsMinor === totals.netMinor;
}

/** The channel's cut of one line's gross commission, in ppm — null when there is no gross to share. */
export function sharePpm(grossCommissionMinor: number, channelCommissionMinor: number): number | null {
  return grossCommissionMinor === 0 ? null : Math.round((channelCommissionMinor / grossCommissionMinor) * 1_000_000);
}

// Latin script, Latin-extended and general punctuation (covers the em-dash) —
// the same script the API's PDF renderer accepts (apps/api rejects the rest
// with a 400). Scanning only row values: a title may legitimately carry an
// em-dash without meaning the statement itself is unsafe to typeset.
const LATIN_SAFE = /^[\x20-\x7E\xa0-\u024f\u2000-\u206f]*$/;

/** Whether this statement's own PDF export would be refused server-side. */
export function pdfSafe(table: LinesPayload["table"]): boolean {
  return table.rows.every((row) => Object.values(row).every((value) => LATIN_SAFE.test(String(value ?? ""))));
}

/** The bare channel id behind a `channel:` reference — as `refFor` built it, reversed. */
export function channelOf(ref: string): string {
  return ref.startsWith("channel:") ? ref.slice("channel:".length) : ref;
}

/** Reads the same `approval_required` gate `settlement.tsx`'s `Gate` renders, for callers that need the policy key itself. */
export function approvalOf(problem: Problem | null): { policyKey: string; approvalId?: string } | null {
  if (!problem) return null;
  const extras = problem as Problem & { code?: string; policy_key?: string; approval_id?: string };
  if (problem.status !== 403 || extras.code !== "approval_required" || !extras.policy_key) return null;
  return extras.approval_id ? { policyKey: extras.policy_key, approvalId: extras.approval_id } : { policyKey: extras.policy_key };
}

const TRANSITIONS: Record<string, { path: string; reason: boolean; confirm: boolean }> = {
  approve: { path: "approve", reason: false, confirm: false },
  pay: { path: "pay", reason: false, confirm: true },
  dispute: { path: "dispute", reason: true, confirm: true },
  reopen: { path: "reopen", reason: true, confirm: true }
};

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    deniedTitle: "You can't open this settlement",
    title: "Settlement",
    intro: "The entries it was drafted from, and the terms that priced them.",
    back: "Back to settlements",
    "state.draft": "Draft",
    "state.approved": "Approved",
    "state.paid": "Paid",
    "state.disputed": "Disputed",
    summaryTitle: "Amounts",
    summaryGross: "Gross",
    summaryAdjustments: "Adjustments",
    summaryNet: "Net",
    netMismatch: "Gross and adjustments no longer add up to net — do not release this until ledger has looked at it.",
    termsTitle: "Terms applied",
    termsMinPayout: "Minimum payout",
    termsAgreement: "Agreement",
    termsAgreementVersion: "version {version}",
    termsNone: "No agreement on file — the platform default terms priced this run.",
    linesTitle: "Remittance lines",
    linesCaption: "Every entry this settlement was drafted from.",
    colShare: "Channel share",
    actionsTitle: "Decide",
    approve: "Approve",
    pay: "Pay",
    dispute: "Dispute",
    reopen: "Reopen",
    confirm: "I confirm this action",
    reason: "Reason",
    reasonHint: "Required — this is written to the audit log.",
    reasonRequired: "Give a reason of at least a few words.",
    reasonTooLong: "Keep the reason under 500 characters.",
    confirmRequired: "Check the confirmation box first.",
    approvalTitle: "Waiting on an approval",
    approvalBody: "This action needs sign-off under {policy} before it can go through.",
    approvalLink: "Open the approval queue",
    exportTitle: "Export",
    exportPdf: "PDF",
    exportXlsx: "XLSX",
    exportPdfUnavailable: "PDF export is unavailable — a line on this statement uses a script the PDF renderer can't typeset."
  },
  ar: {
    deniedTitle: "لا يمكنك فتح هذه التسوية",
    title: "التسوية",
    intro: "القيود التي صيغت منها، والشروط التي سعّرتها.",
    back: "العودة إلى التسويات",
    "state.draft": "مسودة",
    "state.approved": "معتمدة",
    "state.paid": "مدفوعة",
    "state.disputed": "متنازع عليها",
    summaryTitle: "المبالغ",
    summaryGross: "الإجمالي",
    summaryAdjustments: "التسويات",
    summaryNet: "الصافي",
    netMismatch: "لم يعد الإجمالي والتسويات يساويان الصافي — لا تصرف هذا المبلغ قبل أن يراجعه فريق الدفاتر.",
    termsTitle: "الشروط المطبّقة",
    termsMinPayout: "الحد الأدنى للدفع",
    termsAgreement: "الاتفاقية",
    termsAgreementVersion: "الإصدار {version}",
    termsNone: "لا توجد اتفاقية مسجّلة — سعّرت هذه الدورة بالشروط الافتراضية للمنصة.",
    linesTitle: "بنود الحوالة",
    linesCaption: "كل قيد صيغت منه هذه التسوية.",
    colShare: "حصة القناة",
    actionsTitle: "القرار",
    approve: "موافقة",
    pay: "دفع",
    dispute: "نزاع",
    reopen: "إعادة فتح",
    confirm: "أؤكد هذا الإجراء",
    reason: "السبب",
    reasonHint: "مطلوب — يُكتب في سجل التدقيق.",
    reasonRequired: "اكتب سببًا من بضع كلمات على الأقل.",
    reasonTooLong: "اجعل السبب أقل من 500 حرف.",
    confirmRequired: "علّم مربع التأكيد أولًا.",
    approvalTitle: "بانتظار موافقة",
    approvalBody: "يحتاج هذا الإجراء إلى موافقة بموجب {policy} قبل أن يمضي.",
    approvalLink: "افتح قائمة الموافقات",
    exportTitle: "تصدير",
    exportPdf: "PDF",
    exportXlsx: "XLSX",
    exportPdfUnavailable: "تصدير PDF غير متاح — يستخدم أحد بنود هذا الكشف نصًا لا يستطيع محرك PDF تنسيقه."
  }
};

function labelsIn(locale: string): (key: string, vars?: Record<string, string>) => string {
  const table = LABELS[locale] ?? LABELS.en ?? {};
  const fallback = LABELS.en ?? {};
  return (key, vars) => {
    const raw = table[key] ?? fallback[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = { read: held.has(PERM.read), settle: held.has(PERM.settle), pay: held.has(PERM.pay) };
  const apiOrigin = env.API_ORIGIN;
  const idempotencyKey = crypto.randomUUID();
  const shut = { lines: null as LinesPayload | null, may: { ...may, read: false }, apiOrigin, idempotencyKey };

  if (!may.read) return shut;

  try {
    const lines = await api<LinesPayload>(`/v1/settlement/settlements/${id}/lines`, { env, request });
    return { lines, may, apiOrigin, idempotencyKey };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return shut;
    throw error;
  }
}

/* ------------------------------------------------------------------ action */

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const form = await request.formData();
  const nothing = { settlement: null as Settlement | null, problem: null as Problem | null, error: null as string | null };

  const intent = String(form.get("intent") ?? "");
  const spec = TRANSITIONS[intent];
  if (!spec) return { ...nothing, problem: { title: "unknown intent", status: 400 } };

  if (spec.confirm && String(form.get("confirm") ?? "") !== "on") {
    return { ...nothing, error: "confirmRequired" };
  }

  let reason = "";
  if (spec.reason) {
    reason = String(form.get("reason") ?? "").trim();
    const problem = reasonError(reason);
    if (problem) return { ...nothing, error: problem };
  }

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    const settlement = await api<Settlement>(`/v1/settlement/settlements/${id}/${spec.path}`, {
      env,
      request,
      method: "POST",
      ...(key ? { headers: { "idempotency-key": key } } : {}),
      ...(spec.reason ? { body: { reason } } : {})
    });
    return { ...nothing, settlement };
  } catch (error) {
    if (error instanceof ApiError) return { ...nothing, problem: error.problem };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function SettlementDetail() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const locale = "en";
  const t = translator(locale);
  const l = labelsIn(locale);
  const busy = navigation.state !== "idle";

  if (!loaded.may.read || !loaded.lines) {
    return (
      <div className="flex flex-col gap-6">
        <Header l={l} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const { settlement, table, totals, terms } = loaded.lines;
  const holds = netHolds(totals);
  const safe = pdfSafe(table);
  const held = new Set([...(loaded.may.settle ? [PERM.settle] : []), ...(loaded.may.pay ? [PERM.pay] : [])]);
  const transitions = transitionsFor(settlement, held);

  const columns: Array<Column<Record<string, string | number>>> = table.columns.map((col) => ({
    key: col.key,
    header: col.label,
    numeric: col.kind === "money",
    render: (row) =>
      col.kind === "money" ? (
        <Money amountMinor={Number(row[col.key] ?? 0)} currency={table.currency} locale={locale} />
      ) : (
        <span className="font-mono text-12">{String(row[col.key] ?? "—")}</span>
      )
  }));

  return (
    <div className="flex flex-col gap-6">
      <Header l={l} />

      <Link to="/ledger/settlement" className="font-ui text-12 text-accent underline-offset-2 hover:underline">
        {l("back")}
      </Link>

      <Card
        title={l("summaryTitle")}
        actions={
          <Badge tone={settlementTone(settlement.state)} size="sm" dot>
            {l(`state.${settlement.state}`)}
          </Badge>
        }
      >
        <dl className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-1">
            <dt className="font-ui text-11 text-subtle">{l("summaryGross")}</dt>
            <dd>
              <Money amountMinor={totals.grossMinor} currency={table.currency} locale={locale} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-ui text-11 text-subtle">{l("summaryAdjustments")}</dt>
            <dd>
              <Money amountMinor={totals.adjustmentsMinor} currency={table.currency} locale={locale} signed toned />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-ui text-11 text-subtle">{l("summaryNet")}</dt>
            <dd>
              <Money amountMinor={totals.netMinor} currency={table.currency} locale={locale} className="font-ui text-16" />
            </dd>
          </div>
        </dl>
        {!holds ? (
          <p role="alert" className="mt-3 font-ui text-12 text-danger">
            {l("netMismatch")}
          </p>
        ) : null}
      </Card>

      <Card title={l("termsTitle")}>
        <p className="font-ui text-13 text-text">
          {l("termsMinPayout")}: <Money amountMinor={terms.minPayoutMinor} currency={table.currency} locale={locale} />
        </p>
        {terms.agreementId ? (
          <p className="font-ui text-13 text-text">
            {l("termsAgreement")}: <span className="font-mono">{terms.agreementId}</span>
            {terms.agreementVersion !== null ? ` (${l("termsAgreementVersion", { version: String(terms.agreementVersion) })})` : ""}
          </p>
        ) : (
          <p className="font-ui text-13 text-subtle">{l("termsNone")}</p>
        )}
      </Card>

      {transitions.length > 0 ? (
        <Card title={l("actionsTitle")}>
          <div className="flex flex-wrap gap-4">
            {transitions.map((transition) => (
              <TransitionForm
                key={transition.intent}
                transition={transition}
                idempotencyKey={loaded.idempotencyKey}
                l={l}
                busy={busy}
              />
            ))}
          </div>
          {result?.error ? (
            <p role="alert" className="mt-3 font-ui text-13 text-danger">
              {l(result.error)}
            </p>
          ) : null}
          {result?.problem ? <Gate problem={result.problem} l={l} /> : null}
        </Card>
      ) : null}

      <Card
        title={l("exportTitle")}
        actions={
          <div className="flex gap-3">
            {safe ? (
              <a
                href={`${loaded.apiOrigin}/v1/settlement/settlements/${settlement.id}/statement?format=pdf`}
                rel="noopener"
                className="font-ui text-12 text-accent underline-offset-2 hover:underline"
              >
                {l("exportPdf")}
              </a>
            ) : null}
            <a
              href={`${loaded.apiOrigin}/v1/settlement/settlements/${settlement.id}/statement?format=xlsx`}
              rel="noopener"
              className="font-ui text-12 text-accent underline-offset-2 hover:underline"
            >
              {l("exportXlsx")}
            </a>
          </div>
        }
      >
        {!safe ? <p className="font-ui text-12 text-subtle">{l("exportPdfUnavailable")}</p> : null}
      </Card>

      <Card title={l("linesTitle")} padded={false}>
        <Table caption={l("linesCaption")} columns={columns} rows={table.rows} rowKey={(row) => String(row.policyId ?? "")} />
      </Card>
    </div>
  );
}

function TransitionForm({
  transition,
  idempotencyKey,
  l,
  busy
}: {
  transition: Transition;
  idempotencyKey: string;
  l: (key: string, vars?: Record<string, string>) => string;
  busy: boolean;
}) {
  return (
    <Form method="post" className="flex flex-col gap-2 rounded-md border border-line p-3">
      <input type="hidden" name="intent" value={transition.intent} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {transition.reason ? (
        <Field label={l("reason")} hint={l("reasonHint")}>
          <Textarea name="reason" required rows={2} className="w-64" />
        </Field>
      ) : null}
      {transition.confirm ? <Checkbox name="confirm" value="on" label={l("confirm")} /> : null}
      <Button type="submit" variant={transition.intent === "pay" ? "primary" : "secondary"} size="sm" loading={busy}>
        {l(transition.intent)}
      </Button>
    </Form>
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
