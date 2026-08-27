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
  PageHeader,
  PostingFlow,
  StateFlow,
  Table,
  Textarea,
  shortRef,
  type Column,
  type FlowBalance,
  type FlowLeg
} from "@lyra/ui";
import { ApiError, api, fetchMe, type Problem } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { labelsFrom } from "./detail-kit";
import {
  Gate,
  LABELS as QUEUE_LABELS,
  PERM,
  SETTLEMENT_FLOW,
  reasonError,
  settlementTone,
  settlementVisits,
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

/**
 * The settlement as value moving: what the period earned and what was adjusted
 * on one side, what is payable on the other. Not a posting — nothing has hit the
 * ledger until `pay` — so the sides are named in the screen's own words, and the
 * amounts are the API's totals rather than anything computed here.
 */
export function netLegs(totals: LinesPayload["totals"], l: (key: string) => string): FlowLeg[] {
  return [
    { id: "gross", account: "gross", label: l("summaryGross"), side: "debit", amountMinor: totals.grossMinor },
    {
      id: "adjustments",
      account: "adjustments",
      label: l("summaryAdjustments"),
      side: "debit",
      amountMinor: totals.adjustmentsMinor
    },
    { id: "net", account: "net", label: l("summaryNet"), side: "credit", amountMinor: totals.netMinor }
  ];
}

/** The same invariant `netHolds` reports, in the shape the flow diagram checks its own legs against. */
export function netBalance(totals: LinesPayload["totals"]): FlowBalance {
  const debitMinor = totals.grossMinor + totals.adjustmentsMinor;
  return {
    debitMinor,
    creditMinor: totals.netMinor,
    deltaMinor: debitMinor - totals.netMinor,
    balanced: netHolds(totals)
  };
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

export type DetailHeadlineKey = "mismatch" | "actionable" | "plain";

/**
 * Which line the header adds ahead of the net figure: a ledger mismatch beats
 * a pending decision beats a plain readout. Mirrors the `!holds` alert
 * already rendered below (CLAUDE.md §12) so the header never claims a total
 * that card is about to dispute.
 */
export function detailHeadlineKey(holds: boolean, transitionCount: number): DetailHeadlineKey {
  if (!holds) return "mismatch";
  if (transitionCount > 0) return "actionable";
  return "plain";
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

const OWN: Record<string, Record<string, string>> = {
  en: {
    deniedTitle: "You can't open this settlement",
    unavailableTitle: "This statement can't be shown",
    unavailableBody: "The lines behind this settlement couldn't be loaded. Nothing has changed — try again, or open it from the settlements list.",
    title: "Settlement",
    intro: "The entries it was drafted from, and the terms that priced them.",
    back: "Back to settlements",
    "headline.mismatch": "Net no longer adds up — do not release. Net",
    "headline.actionable": "{count} decision open. Net",
    "headline.plain": "Net",
    summaryTitle: "Amounts",
    flowTitle: "Where this settlement is",
    flowLabel: "Settlement progress",
    flowFrom: "Earned this period",
    flowTo: "Payable",
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
    linesEmpty: "No entries were drafted into this settlement.",
    "linesEmpty.body": "A settlement to an insurer has no commission lines — those are keyed by channel. Its net comes from the statement above.",
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
    exportTitle: "Export",
    exportPdf: "PDF",
    exportXlsx: "XLSX",
    exportPdfUnavailable: "PDF export is unavailable — a line on this statement uses a script the PDF renderer can't typeset."
  },
  ar: {
    deniedTitle: "لا يمكنك فتح هذه التسوية",
    unavailableTitle: "تعذّر عرض هذا الكشف",
    unavailableBody: "تعذّر تحميل بنود هذه التسوية. لم يتغيّر شيء — أعد المحاولة أو افتحها من قائمة التسويات.",
    title: "التسوية",
    intro: "القيود التي صيغت منها، والشروط التي سعّرتها.",
    back: "العودة إلى التسويات",
    "headline.mismatch": "لم يعد الصافي متوازنًا — لا تصرفه. الصافي",
    "headline.actionable": "{count} قرار مفتوح. الصافي",
    "headline.plain": "الصافي",
    summaryTitle: "المبالغ",
    flowTitle: "موضع هذه التسوية",
    flowLabel: "مسار التسوية",
    flowFrom: "المحقّق في هذه الفترة",
    flowTo: "المستحق للدفع",
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
    linesEmpty: "لم يُدرج أي قيد في هذه التسوية.",
    "linesEmpty.body": "التسوية إلى شركة تأمين لا تحمل سطور عمولة — فتلك مرتبطة بالقناة. صافيها يأتي من الكشف أعلاه.",
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
    exportTitle: "تصدير",
    exportPdf: "PDF",
    exportXlsx: "XLSX",
    exportPdfUnavailable: "تصدير PDF غير متاح — يستخدم أحد بنود هذا الكشف نصًا لا يستطيع محرك PDF تنسيقه."
  }
};

/**
 * A settlement speaks the queue's vocabulary — the four state names above all —
 * and adds its own words on top. Resolving through detail-kit's `labelsFrom`
 * (docs/ui.md §7 P3-14) is what puts the shared `approval*` words behind the
 * `<Gate>` notice; hand-rolling the lookup here rendered them as bare keys.
 */
export const LABELS: Record<string, Record<string, string>> = {
  en: { ...QUEUE_LABELS.en, ...OWN.en },
  ar: { ...QUEUE_LABELS.ar, ...OWN.ar }
};

export const labelsIn = labelsFrom(LABELS);

/* ------------------------------------------------------------------ loader */

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const id = params.id as string;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = { read: held.has(PERM.read), settle: held.has(PERM.settle), pay: held.has(PERM.pay) };
  const apiOrigin = env.API_ORIGIN;
  const idempotencyKey = crypto.randomUUID();
  // Two separate facts, and conflating them made the screen lie: `may.read` is
  // whether this actor holds dist:commissions:read, `lines: null` is whether
  // the statement could be fetched. A 4xx on /lines forced read:false and an
  // all-roles administrator was told they lacked a permission they hold.
  const shut = { lines: null as LinesPayload | null, may, apiOrigin, idempotencyKey };

  if (!may.read) return { ...shut, may: { ...may, read: false } };

  try {
    const lines = await api<LinesPayload>(`/v1/settlement/settlements/${id}/lines`, { env, request });
    return { lines, may, apiOrigin, idempotencyKey };
  } catch (error) {
    // What must NOT be swallowed, rather than a list of what may: a 401 still
    // needs the login redirect and a 5xx is a real fault, but any other 4xx is
    // this settlement's lines being unavailable, not a crash (sighting 8).
    if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401) return shut;
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

  const back = (
    <Link to="/ledger/settlement" className="w-fit font-ui text-12 text-subtle underline-offset-2 hover:underline">
      {l("back")}
    </Link>
  );

  if (!loaded.may.read || !loaded.lines) {
    const denied = !loaded.may.read;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={l("title")} description={l("intro")} back={back} />
        <EmptyState
          title={denied ? l("deniedTitle") : l("unavailableTitle")}
          body={denied ? t("error.forbidden") : l("unavailableBody")}
        />
      </div>
    );
  }

  const { settlement, table, totals, terms } = loaded.lines;
  const holds = netHolds(totals);
  const safe = pdfSafe(table);
  const held = new Set([...(loaded.may.settle ? [PERM.settle] : []), ...(loaded.may.pay ? [PERM.pay] : [])]);
  const transitions = transitionsFor(settlement, held);
  const status = detailHeadlineKey(holds, transitions.length);

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
      <PageHeader
        eyebrow={l("title")}
        title={
          <>
            {status === "actionable" ? l("headline.actionable", { count: String(transitions.length) }) : l(`headline.${status}`)}{" "}
            <Money amountMinor={totals.netMinor} currency={table.currency} locale={locale} />
          </>
        }
        description={l("intro")}
        back={back}
      />

      <Card
        title={l("summaryTitle")}
        actions={
          <Badge tone={settlementTone(settlement.state)} size="sm" dot>
            {l(`state.${settlement.state}`)}
          </Badge>
        }
      >
        {/* The same three figures the API returned, drawn as the movement they
            describe: earned less adjusted, arriving as payable. `PostingFlow`
            re-adds the legs and will not call the sides equal unless they are,
            so `netMismatch` is raised by the arithmetic, not by copy. */}
        <PostingFlow
          legs={netLegs(totals, l)}
          currency={table.currency}
          balance={netBalance(totals)}
          fromLabel={l("flowFrom")}
          toLabel={l("flowTo")}
          label={l("summaryTitle")}
          note={l("netMismatch")}
          locale={locale}
        />
      </Card>

      <Card title={l("flowTitle")}>
        <StateFlow
          machine={SETTLEMENT_FLOW}
          visits={settlementVisits(settlement)}
          current={settlement.state}
          label={l("flowLabel")}
          labelFor={(state) => l(`state.${state}`)}
          locale={locale}
        />
      </Card>

      <Card title={l("termsTitle")}>
        <p className="font-ui text-13 text-text">
          {l("termsMinPayout")}: <Money amountMinor={terms.minPayoutMinor} currency={table.currency} locale={locale} />
        </p>
        {terms.agreementId ? (
          <p className="font-ui text-13 text-text">
            {l("termsAgreement")}: <span className="font-mono">{shortRef(terms.agreementId)}</span>
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
        <Table
          caption={l("linesCaption")}
          columns={columns}
          rows={table.rows}
          rowKey={(row) => String(row.policyId ?? "")}
          empty={<EmptyState title={l("linesEmpty")} body={l("linesEmpty.body")} />}
        />
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
