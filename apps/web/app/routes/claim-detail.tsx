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
  MoneyField,
  Ref,
  Select,
  Stat,
  Table,
  formatMoney,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe, names, type Problem } from "../api.server";
import { RefPicker, type RefOption } from "../components/ref-picker";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { humanise } from "../modules/spec";
import { Entry, Facts, Header, Payload, labelsFrom, rowsOf, safe, tag, type Label, type Page } from "./detail-kit";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// One claim: what was reported, what cover answered for it, what it is reserved
// at, what has left through the ledger, and what is being chased back.
//
// Three writes, kept apart on purpose (docs/specs/gap-axis-design.md §D.3):
//   reserve         — appends a movement with a basis, never overwrites the
//                     estimate, so the desk keeps its own history
//   transition      — a declared hop from `CLAIM_TRANSITIONS`, so the screen
//                     cannot offer a move the state machine refuses
//   request-payment — money leaves through the ledger, never through a PATCH
// The last two go through the `axis.claim_settlement` gate
// (apps/api/src/resources.ts), so both surface the approval path instead of
// pretending the write landed (CLAUDE.md §4, §12).

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
  /** The cover snapshot taken at notification — §D.3's coverage panel. */
  policyVersionId?: string | null;
  coverageState?: string | null;
  coverageCheckedAt?: number | null;
  excessMinor?: number | null;
  reserveMinor?: number | null;
  paidMinor?: number | null;
  recoveredMinor?: number | null;
  fraudScore?: number | null;
  siuState?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReserveRow {
  id: string;
  seq: number;
  head: string;
  amountMinor: number;
  previousMinor: number;
  basis: string;
  rationale?: string | null;
  approvalId?: string | null;
  setBy: string;
  setAt: number;
}

export interface PaymentRow {
  id: string;
  kind: string;
  payeeKind: string;
  payeeRef: string;
  amountMinor: number;
  currency: string;
  method: string;
  state: string;
  requestedAt: number;
  paidAt?: number | null;
}

export interface RecoveryRow {
  id: string;
  kind: string;
  counterpartyRef?: string | null;
  expectedMinor: number;
  recoveredMinor: number;
  currency: string;
  state: string;
  nextActionAt?: number | null;
  openedAt: number;
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
  reserve: "axis:claims:reserve",
  pay: "axis:claims:pay",
  policy: "axis:policies:read",
  documents: "axis:documents:read",
  approvals: "core:approvals:read",
  audit: "core:audit:read"
} as const;

/**
 * Mirrors packages/core/src/lifecycle.ts. The web app cannot import @lyra/core
 * (same reason approvals.tsx restates the approval states). Drift is caught by
 * the API, which refuses a hop this map would wrongly allow.
 */
export const CLAIM_TRANSITIONS: Record<string, readonly string[]> = {
  reported: ["triage", "withdrawn"],
  triage: ["assessing", "rejected", "withdrawn"],
  assessing: ["awaiting_docs", "approved", "rejected", "withdrawn"],
  awaiting_docs: ["assessing", "withdrawn"],
  approved: ["settling"],
  settling: ["settled", "approved"],
  settled: ["recovering", "closed", "reopened"],
  recovering: ["closed", "reopened"],
  rejected: ["reopened", "closed"],
  closed: ["reopened"],
  reopened: ["assessing"],
  withdrawn: []
};

/**
 * The hops this screen may offer. `settling` and `settled` are reached by
 * requesting a payment — the API refuses them as transitions, so offering them
 * would be a dead end the desk discovers only after submitting.
 */
export function hopsFor(status: string): readonly string[] {
  return (CLAIM_TRANSITIONS[status] ?? []).filter((to) => to !== "settling" && to !== "settled");
}

/** Where a reserve sits. Mirrors RESERVE_HEADS in the claims engine. */
export const RESERVE_HEADS = ["indemnity", "expense", "recovery"] as const;

/**
 * Why the reserve moved. `ai_recommended` is deliberately absent: a person
 * typing into this form is not the model, and the basis is what the audit
 * reads back (docs/15 — an AI artifact carries its own marker and its own why).
 */
export const RESERVE_BASES = ["assessor", "desk_estimate", "insurer_advised", "closure"] as const;

export const PAY_KINDS = ["indemnity", "expense", "interim", "final", "ex_gratia", "excess_refund"] as const;
export const PAYEE_KINDS = ["claimant", "repairer", "provider", "third_party", "insurer"] as const;
export const PAY_METHODS = ["eft", "cheque", "card", "insurer_direct"] as const;

/**
 * A payee is a namespaced ref (`customer:cu_01KE…`, `vendor:garage-1`), so the
 * box cannot become a plain picker. The one payee a desk reaches for most is
 * the claimant, and the claim already knows who that is — offer them by name
 * and leave every other payee to the typed ref.
 */
export function payeeOptions(customerId: string, holder: string | null): RefOption[] {
  return holder ? [{ id: `customer:${customerId}`, label: holder }] : [];
}

/* ---------------------------------------------------------------- labels */

export const LABELS: Record<string, Record<string, string>> = {
  en: {
    intro: "What was reported, what it is reserved at, the paper behind it, and who signed off.",
    back: "Back to the register",
    heroLede: "{status} · {incurred} incurred",
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
    reserveTitle: "Reserve",
    reserveIntro: "Say what the claim is now worth and why. Each figure is added to the history; nothing is written over.",
    reserveHead: "Head",
    reserveAmount: "Reserve after this movement",
    reserveBasis: "Basis",
    reserveRationale: "Why",
    reserveSubmit: "Add the reserve",
    reserveDone: "The reserve was added.",
    reserveRequired: "Enter the reserve as an amount of zero or more.",
    basisRequired: "Choose what the figure is based on.",
    hopTitle: "Move the claim",
    hopIntro: "Only the moves the claim can legally make are offered. Settlement is reached by requesting a payment.",
    outcome: "Move to",
    hopReason: "Note",
    hopSubmit: "Move the claim",
    transitionDone: "The claim was moved.",
    outcomeRequired: "Choose a move the claim can make from where it stands.",
    noHops: "This claim has nowhere left to go.",
    payTitle: "Payment",
    payIntro: "A payment leaves through the ledger and is held until it is approved. Nothing is paid from this screen.",
    payKind: "Kind",
    payPayeeKind: "Paid to",
    payPayeeRef: "Payee",
    payPayeeHint: "Name, or vendor:garage-1",
    payAmount: "Amount",
    payMethod: "Method",
    paySubmit: "Request the payment",
    paymentDone: "The payment was requested.",
    payRequired: "Name a payee and enter the amount as a whole number above zero.",
    coverageTitle: "Cover at the loss",
    coverageCaption: "The version of the contract that answered for this incident.",
    coverageStateLabel: "Cover",
    coverageVersion: "Version in force",
    coverageChecked: "Checked",
    excess: "Excess",
    fraud: "Fraud score",
    siu: "Investigation",
    incurred: "Incurred",
    paid: "Paid",
    recovered: "Recovered",
    reservesTitle: "Reserve history",
    reservesCaption: "Every movement of this claim's reserve, newest first.",
    paymentsTitle: "Payments",
    paymentsCaption: "What has left on this claim, newest first.",
    recoveriesTitle: "Recoveries",
    recoveriesCaption: "What is being chased back, newest first.",
    colSeq: "#",
    colHead: "Head",
    colBasis: "Basis",
    colMovement: "From → to",
    colPayee: "Payee",
    colExpected: "Expected",
    colRecovered: "Recovered",
    colMethod: "Method",
    "status.triage": "Triage",
    "status.settling": "Settling",
    "status.recovering": "Recovering",
    "status.closed": "Closed",
    "status.reopened": "Reopened",
    "basis.assessor": "Assessor",
    "basis.desk_estimate": "Desk estimate",
    "basis.insurer_advised": "Insurer advised",
    "basis.closure": "Closure",
    "basis.ai_recommended": "Suggested",
    "basis.formula": "Formula",
    "head.indemnity": "Indemnity",
    "head.expense": "Expense",
    "head.recovery": "Recovery",
    "kind.indemnity": "Indemnity",
    "kind.expense": "Expense",
    "kind.interim": "Interim",
    "kind.final": "Final",
    "kind.ex_gratia": "Goodwill",
    "kind.excess_refund": "Excess refund",
    "kind.subrogation": "Subrogation",
    "kind.salvage": "Salvage",
    "kind.excess": "Excess",
    "kind.reinsurance": "Reinsurance",
    "kind.third_party": "Third party",
    "payee.claimant": "Claimant",
    "payee.repairer": "Repairer",
    "payee.provider": "Provider",
    "payee.third_party": "Third party",
    "payee.insurer": "Insurer",
    "method.eft": "Transfer",
    "method.cheque": "Cheque",
    "method.card": "Card",
    "method.insurer_direct": "Paid by insurer",
    "state.requested": "Requested",
    "state.failed": "Failed",
    "state.reversed": "Reversed",
    "state.identified": "Identified",
    "state.pursuing": "Being chased",
    "state.agreed": "Agreed",
    "state.recovered": "Recovered",
    "coverage.in_force": "On risk",
    "coverage.not_yet_incepted": "Not yet started",
    "coverage.lapsed_at_loss": "Lapsed at the loss",
    "coverage.cancelled_at_loss": "Cancelled at the loss",
    "coverage.out_of_cover": "Outside cover",
    "coverage.unknown": "Not checked",
    "siu.referred": "Referred",
    "siu.clearing": "Being cleared",
    "siu.substantiated": "Substantiated",
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
    heroLede: "{status} · متكبد {incurred}",
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
    reserveTitle: "الاحتياطي",
    reserveIntro: "حدّد قيمة المطالبة الآن وسبب ذلك. كل رقم يُضاف إلى السجل، ولا يُستبدل أي رقم سابق.",
    reserveHead: "البند",
    reserveAmount: "الاحتياطي بعد هذه الحركة",
    reserveBasis: "الأساس",
    reserveRationale: "السبب",
    reserveSubmit: "إضافة الاحتياطي",
    reserveDone: "تمت إضافة الاحتياطي.",
    reserveRequired: "أدخل الاحتياطي كمبلغ صفر أو أكثر.",
    basisRequired: "اختر الأساس الذي بُني عليه الرقم.",
    hopTitle: "تحريك المطالبة",
    hopIntro: "تُعرض الحركات المسموح بها فقط. التسوية تتم بطلب دفعة.",
    outcome: "الانتقال إلى",
    hopReason: "ملاحظة",
    hopSubmit: "تحريك المطالبة",
    transitionDone: "تم تحريك المطالبة.",
    outcomeRequired: "اختر حركة متاحة من الوضع الحالي للمطالبة.",
    noHops: "لا توجد حركة متاحة لهذه المطالبة.",
    payTitle: "الدفع",
    payIntro: "الدفعة تخرج عبر دفتر الأستاذ وتبقى معلّقة حتى الموافقة. لا يتم الدفع من هذه الشاشة.",
    payKind: "النوع",
    payPayeeKind: "جهة الدفع",
    payPayeeRef: "المستفيد",
    payPayeeHint: "الاسم، أو vendor:garage-1",
    payAmount: "المبلغ",
    payMethod: "الوسيلة",
    paySubmit: "طلب الدفع",
    paymentDone: "تم طلب الدفع.",
    payRequired: "حدّد المستفيد وأدخل المبلغ كرقم صحيح أكبر من صفر.",
    coverageTitle: "التغطية وقت الحادث",
    coverageCaption: "نسخة العقد التي كانت سارية على هذا الحادث.",
    coverageStateLabel: "التغطية",
    coverageVersion: "النسخة السارية",
    coverageChecked: "تاريخ التحقق",
    excess: "التحمّل",
    fraud: "مؤشر الاحتيال",
    siu: "التحقيق",
    incurred: "المتكبد",
    paid: "المدفوع",
    recovered: "المسترد",
    reservesTitle: "سجل الاحتياطي",
    reservesCaption: "كل حركة على احتياطي هذه المطالبة، الأحدث أولًا.",
    paymentsTitle: "المدفوعات",
    paymentsCaption: "ما تم صرفه على هذه المطالبة، الأحدث أولًا.",
    recoveriesTitle: "الاستردادات",
    recoveriesCaption: "ما يجري استرداده، الأحدث أولًا.",
    colSeq: "التسلسل",
    colHead: "البند",
    colBasis: "الأساس",
    colMovement: "من ← إلى",
    colPayee: "المستفيد",
    colExpected: "المتوقع",
    colRecovered: "المسترد",
    colMethod: "الوسيلة",
    "status.triage": "الفرز",
    "status.settling": "قيد التسوية",
    "status.recovering": "قيد الاسترداد",
    "status.closed": "مغلقة",
    "status.reopened": "أُعيد فتحها",
    "basis.assessor": "المُقيّم",
    "basis.desk_estimate": "تقدير المكتب",
    "basis.insurer_advised": "إفادة شركة التأمين",
    "basis.closure": "الإغلاق",
    "basis.ai_recommended": "مقترح",
    "basis.formula": "معادلة",
    "head.indemnity": "التعويض",
    "head.expense": "المصروفات",
    "head.recovery": "الاسترداد",
    "kind.indemnity": "تعويض",
    "kind.expense": "مصروف",
    "kind.interim": "دفعة مؤقتة",
    "kind.final": "دفعة نهائية",
    "kind.ex_gratia": "دفعة ودّية",
    "kind.excess_refund": "ردّ التحمّل",
    "kind.subrogation": "الحلول",
    "kind.salvage": "الخردة",
    "kind.excess": "التحمّل",
    "kind.reinsurance": "إعادة التأمين",
    "kind.third_party": "طرف ثالث",
    "payee.claimant": "المطالِب",
    "payee.repairer": "الورشة",
    "payee.provider": "مقدّم الخدمة",
    "payee.third_party": "طرف ثالث",
    "payee.insurer": "شركة التأمين",
    "method.eft": "تحويل",
    "method.cheque": "شيك",
    "method.card": "بطاقة",
    "method.insurer_direct": "دفع مباشر من شركة التأمين",
    "state.requested": "مطلوبة",
    "state.failed": "فشلت",
    "state.reversed": "عُكست",
    "state.identified": "محددة",
    "state.pursuing": "قيد المتابعة",
    "state.agreed": "متفق عليها",
    "state.recovered": "مستردة",
    "coverage.in_force": "سارية",
    "coverage.not_yet_incepted": "لم تبدأ بعد",
    "coverage.lapsed_at_loss": "منقضية وقت الحادث",
    "coverage.cancelled_at_loss": "ملغاة وقت الحادث",
    "coverage.out_of_cover": "خارج التغطية",
    "coverage.unknown": "لم يتم التحقق",
    "siu.referred": "محالة",
    "siu.clearing": "قيد التصفية",
    "siu.substantiated": "مثبتة",
    documentsTitle: "المستندات",
    documentsCaption: "الأدلة المرفقة ببند العمل الخاص بهذه المطالبة.",
    approvalsTitle: "الموافقات",
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

/** The line under the claim number: its status and what it has cost so far —
 * reserved plus paid less recovered, the same figure the summary Stat shows.
 * No ✦ (arithmetic and formatting on the loaded record, not a model finding,
 * CLAUDE.md §11). */
export function claimLede(
  claim: Pick<Claim, "status">,
  incurredMinor: number,
  currency: string,
  l: Label,
  locale: string
): string {
  return l("heroLede", { status: tag(l, "status", claim.status), incurred: formatMoney(incurredMinor, currency, locale) });
}

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
    reserve: held.has(PERM.reserve),
    pay: held.has(PERM.pay)
  };

  const empty = {
    claim: null as Claim | null,
    policy: null as PolicyRef | null,
    documents: [] as DocumentRow[],
    approvals: [] as ApprovalRow[],
    trail: [] as AuditRow[],
    reserves: [] as ReserveRow[],
    payments: [] as PaymentRow[],
    recoveries: [] as RecoveryRow[],
    may,
    holder: null as string | null,
    idempotencyKey: crypto.randomUUID()
  };

  if (!may.read) return empty;
  const claim = await safe(() => api<Claim>(`/v1/axis/claims/${id}`, options), null);
  if (!claim) return empty;

  // Evidence hangs off the work item, not the claim, so that read needs the
  // claim first. The rest of the fan-out is independent.
  const [policy, documents, approvals, trail, reserves, payments, recoveries, named] = await Promise.all([
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
      : null,
    // The claim's own money. Each panel degrades on its own so a desk that may
    // see the claim but not its payments still gets the claim.
    safe(() => api<Page<ReserveRow>>(`/v1/axis/claims/${id}/reserves?limit=25`, options), null),
    safe(() => api<Page<PaymentRow>>(`/v1/axis/claims/${id}/payments`, options), null),
    safe(() => api<Page<RecoveryRow>>(`/v1/axis/claims/${id}/recoveries`, options), null),
    names([claim.customerId], options).catch(() => ({}) as Record<string, string>)
  ]);

  return {
    ...empty,
    claim,
    policy,
    documents: rowsOf(documents),
    approvals: rowsOf(approvals),
    trail: rowsOf(trail),
    reserves: rowsOf(reserves),
    payments: rowsOf(payments),
    recoveries: rowsOf(recoveries),
    holder: named[claim.customerId] ?? null
  };
}

/* ------------------------------------------------------------------ action */

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id ?? String(form.get("id") ?? "");
  const nothing = { done: null as string | null, problem: null as Problem | null, error: null as string | null };

  const text = (name: string) => String(form.get(name) ?? "").trim();

  let path: string;
  let body: Record<string, unknown>;
  let suffix: string;
  let done: string;

  if (intent === "reserve") {
    const head = text("head") || "indemnity";
    const raw = text("amountMinor");
    const amountMinor = Number(raw);
    if (!(RESERVE_HEADS as readonly string[]).includes(head)) return { ...nothing, error: "reserveRequired" };
    if (raw === "" || !Number.isInteger(amountMinor) || amountMinor < 0) {
      return { ...nothing, error: "reserveRequired" };
    }
    const basis = text("basis");
    if (!(RESERVE_BASES as readonly string[]).includes(basis)) return { ...nothing, error: "basisRequired" };
    const rationale = text("rationale");
    path = `/v1/axis/claims/${id}/reserves`;
    body = { head, amountMinor, basis, ...(rationale ? { rationale } : {}) };
    // Two reserves in one page load are a normal afternoon, so the key carries
    // what it would write. A per-intent suffix alone would replay the first.
    suffix = `reserve:${head}:${amountMinor}`;
    done = "reserveDone";
  } else if (intent === "transition") {
    const to = text("to");
    if (!hopsFor(text("from")).includes(to)) return { ...nothing, error: "outcomeRequired" };
    const reason = text("reason");
    path = `/v1/axis/claims/${id}/transition`;
    body = { to, ...(reason ? { reason } : {}) };
    suffix = `transition:${to}`;
    done = "transitionDone";
  } else if (intent === "request-payment") {
    const raw = text("amountMinor");
    const amountMinor = Number(raw);
    const payeeRef = text("payeeRef");
    const payeeKind = text("payeeKind");
    if (raw === "" || !Number.isInteger(amountMinor) || amountMinor <= 0 || !payeeRef) {
      return { ...nothing, error: "payRequired" };
    }
    if (!(PAYEE_KINDS as readonly string[]).includes(payeeKind)) return { ...nothing, error: "payRequired" };
    const kind = text("kind") || "indemnity";
    const method = text("method") || "eft";
    path = `/v1/axis/claims/${id}/payments`;
    body = { kind, payeeKind, payeeRef, amountMinor, method };
    suffix = `payment:${amountMinor}`;
    done = "paymentDone";
  } else {
    return { ...nothing, problem: { title: "unknown intent", status: 400 } };
  }

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    // A hop and a payment are gated by `axis.claim_settlement`, and a large
    // reserve by `axis.claim_reserve`; a 403 with `approval_required` is the
    // normal answer here, not an error to hide.
    await api<unknown>(path, {
      env,
      request,
      method: "POST",
      ...(key ? { headers: { "idempotency-key": `${key}:${suffix}` } } : {}),
      body
    });
    return { ...nothing, done };
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
    { key: "policyKey", header: l("colPolicyKey"), render: (row) => humanise(row.policyKey) },
    {
      key: "decision",
      header: l("colOutcome"),
      render: (row) => <Badge size="sm">{tag(l, "decision", row.decision)}</Badge>
    },
    { key: "requestedBy", header: l("colWho"), render: (row) => <Ref value={row.requestedBy} className="text-12" /> },
    {
      key: "requestedAt",
      header: l("colWhen"),
      render: (row) => <DateTime value={row.requestedAt} locale={locale} precision="minute" />
    },
    { key: "reason", header: l("colReason"), render: (row) => <span className="font-ui text-12">{row.reason ?? "—"}</span> }
  ];

  const money = (amountMinor: number) => (
    <Money amountMinor={amountMinor} currency={claim.currency} locale={locale} />
  );

  // What the claim has cost so far: what is still held for it, plus what has
  // left, less what has come back. `amountMinor` is the notified figure and
  // only stands in until the desk sets its first reserve.
  const reserveMinor = claim.reserveMinor ?? claim.amountMinor ?? 0;
  const paidMinor = claim.paidMinor ?? 0;
  const recoveredMinor = claim.recoveredMinor ?? 0;
  const incurredMinor = reserveMinor + paidMinor - recoveredMinor;

  const hops = hopsFor(claim.status);

  const reserveColumns: Array<Column<ReserveRow>> = [
    { key: "seq", header: l("colSeq"), numeric: true, render: (row) => <span className="font-mono text-12">{row.seq}</span> },
    { key: "setAt", header: l("colWhen"), render: (row) => <DateTime value={row.setAt} locale={locale} precision="minute" /> },
    { key: "head", header: l("colHead"), render: (row) => tag(l, "head", row.head) },
    {
      key: "amountMinor",
      header: l("colMovement"),
      numeric: true,
      render: (row) => (
        <span className="font-mono text-12">
          {money(row.previousMinor)} → {money(row.amountMinor)}
        </span>
      )
    },
    { key: "basis", header: l("colBasis"), render: (row) => <Badge size="sm">{tag(l, "basis", row.basis)}</Badge> },
    { key: "rationale", header: l("colReason"), render: (row) => <span className="font-ui text-12">{row.rationale ?? "—"}</span> },
    { key: "setBy", header: l("colWho"), render: (row) => <Ref value={row.setBy} className="text-12" /> }
  ];

  const paymentColumns: Array<Column<PaymentRow>> = [
    { key: "requestedAt", header: l("colWhen"), render: (row) => <DateTime value={row.requestedAt} locale={locale} precision="minute" /> },
    { key: "kind", header: l("colKind"), render: (row) => tag(l, "kind", row.kind) },
    {
      key: "payeeRef",
      header: l("colPayee"),
      render: (row) => (
        <span className="font-ui text-12">
          {tag(l, "payee", row.payeeKind)} · <Ref value={row.payeeRef} className="text-12" />
        </span>
      )
    },
    { key: "amountMinor", header: l("colAmount"), numeric: true, render: (row) => money(row.amountMinor) },
    { key: "method", header: l("colMethod"), render: (row) => tag(l, "method", row.method) },
    { key: "state", header: l("colStatus"), render: (row) => <Badge size="sm" dot>{tag(l, "state", row.state)}</Badge> }
  ];

  const recoveryColumns: Array<Column<RecoveryRow>> = [
    { key: "openedAt", header: l("colWhen"), render: (row) => <DateTime value={row.openedAt} locale={locale} precision="day" /> },
    { key: "kind", header: l("colKind"), render: (row) => tag(l, "kind", row.kind) },
    {
      key: "counterpartyRef",
      header: l("colPayee"),
      render: (row) => (row.counterpartyRef ? <Ref value={row.counterpartyRef} className="text-12" /> : <span>—</span>)
    },
    { key: "expectedMinor", header: l("colExpected"), numeric: true, render: (row) => money(row.expectedMinor) },
    { key: "recoveredMinor", header: l("colRecovered"), numeric: true, render: (row) => money(row.recoveredMinor) },
    { key: "state", header: l("colStatus"), render: (row) => <Badge size="sm" dot>{tag(l, "state", row.state)}</Badge> }
  ];

  const trailColumns: Array<Column<AuditRow>> = [
    { key: "action", header: l("colAction"), render: (row) => humanise(row.action) },
    { key: "actorRef", header: l("colWho"), render: (row) => <Ref value={row.actorRef} className="text-12" /> },
    { key: "ts", header: l("colWhen"), render: (row) => <DateTime value={row.ts} locale={locale} precision="minute" /> }
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-22 leading-[1.2] text-text">{`${l("claimNo")} ${claim.claimNo}`}</h1>
          <p className="font-ui text-13 text-muted">{claimLede(claim, incurredMinor, claim.currency, l, locale)}</p>
          <Link to="/axis/claims" className="w-fit font-ui text-13 text-accent underline">
            {l("back")}
          </Link>
        </div>
      </header>

      <Card
        title={l("summaryTitle")}
        actions={
          <Badge size="sm" dot>
            {tag(l, "status", claim.status)}
          </Badge>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label={l("incurred")} value={money(incurredMinor)} />
          <Stat label={l("reserved")} value={money(reserveMinor)} />
          <Stat label={l("paid")} value={money(paidMinor)} />
          <Stat label={l("recovered")} value={money(recoveredMinor)} />
          <Stat label={l("reportedAt")} value={<DateTime value={claim.reportedAt} locale={locale} precision="day" />} />
        </div>
        <Facts>
          <Entry term={l("incidentAt")}>
            {claim.incidentAt ? <DateTime value={claim.incidentAt} locale={locale} precision="day" /> : "—"}
          </Entry>
          <Entry term={l("holder")}>
            <Link to={`/admin/customers/${claim.customerId}/360`} className="text-accent hover:underline">
              {loaded.holder ?? <Ref value={claim.customerId} />}
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
                <Ref value={claim.caseId} />
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

      <Card title={l("coverageTitle")} description={l("coverageCaption")}>
        <Facts>
          <Entry term={l("coverageStateLabel")}>
            <Badge size="sm" dot>
              {tag(l, "coverage", claim.coverageState ?? "unknown")}
            </Badge>
          </Entry>
          <Entry term={l("coverageVersion")}>
            {claim.policyVersionId ? (
              <Link to={`/axis/policies/${claim.policyId}/detail`} className="text-accent hover:underline">
                <Ref value={claim.policyVersionId} className="text-12" />
              </Link>
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("coverageChecked")}>
            {claim.coverageCheckedAt ? (
              <DateTime value={claim.coverageCheckedAt} locale={locale} precision="minute" />
            ) : (
              "—"
            )}
          </Entry>
          <Entry term={l("excess")}>{claim.excessMinor == null ? "—" : money(claim.excessMinor)}</Entry>
          <Entry term={l("fraud")}>
            <span className="font-mono text-12">{claim.fraudScore ?? "—"}</span>
          </Entry>
          <Entry term={l("siu")}>{claim.siuState ? tag(l, "siu", claim.siuState) : "—"}</Entry>
        </Facts>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {loaded.may.reserve ? (
          <Card title={l("reserveTitle")} description={l("reserveIntro")}>
            <Form method="post" className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="intent" value="reserve" />
              <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("reserveHead")}
                <Select
                  name="head"
                  defaultValue="indemnity"
                  options={RESERVE_HEADS.map((value) => ({ value, label: tag(l, "head", value) }))}
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("reserveAmount")}
                <MoneyField name="amountMinor" currency={claim.currency} locale={locale} required className="w-40" />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("reserveBasis")}
                <Select
                  name="basis"
                  defaultValue="desk_estimate"
                  options={RESERVE_BASES.map((value) => ({ value, label: tag(l, "basis", value) }))}
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("reserveRationale")}
                <Input name="rationale" className="w-56" />
              </label>
              <Button type="submit" loading={busy}>
                {l("reserveSubmit")}
              </Button>
            </Form>
          </Card>
        ) : null}

        {loaded.may.update ? (
          <Card title={l("hopTitle")} description={l("hopIntro")}>
            {hops.length === 0 ? (
              <EmptyState title={l("noHops")} />
            ) : (
              <Form method="post" className="flex flex-wrap items-end gap-4">
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="from" value={claim.status} />
                <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
                <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                  {l("outcome")}
                  <Select
                    name="to"
                    defaultValue={hops[0] ?? ""}
                    options={hops.map((value) => ({ value, label: tag(l, "status", value) }))}
                  />
                </label>
                <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                  {l("hopReason")}
                  <Input name="reason" className="w-56" />
                </label>
                <Button type="submit" loading={busy}>
                  {l("hopSubmit")}
                </Button>
              </Form>
            )}
          </Card>
        ) : null}

        {loaded.may.pay ? (
          <Card title={l("payTitle")} description={l("payIntro")}>
            <Form method="post" className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="intent" value="request-payment" />
              <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("payKind")}
                <Select
                  name="kind"
                  defaultValue="indemnity"
                  options={PAY_KINDS.map((value) => ({ value, label: tag(l, "kind", value) }))}
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("payPayeeKind")}
                <Select
                  name="payeeKind"
                  defaultValue="claimant"
                  options={PAYEE_KINDS.map((value) => ({ value, label: tag(l, "payee", value) }))}
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("payPayeeRef")}
                <RefPicker
                  name="payeeRef"
                  options={payeeOptions(claim.customerId, loaded.holder)}
                  placeholder={l("payPayeeHint")}
                  required
                  className="w-56"
                />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("payAmount")}
                <MoneyField name="amountMinor" currency={claim.currency} locale={locale} required className="w-40" />
              </label>
              <label className="flex flex-col gap-1 font-ui text-12 text-muted">
                {l("payMethod")}
                <Select
                  name="method"
                  defaultValue="eft"
                  options={PAY_METHODS.map((value) => ({ value, label: tag(l, "method", value) }))}
                />
              </label>
              <Button type="submit" variant="primary" loading={busy}>
                {l("paySubmit")}
              </Button>
            </Form>
          </Card>
        ) : null}
      </div>

      {result?.error ? (
        <p role="alert" className="font-ui text-13 text-danger">
          {l(result.error)}
        </p>
      ) : null}
      {result?.done ? <p className="font-ui text-13 text-success">{l(result.done)}</p> : null}
      {result?.problem ? <Gate problem={result.problem} l={l} /> : null}

      <Card title={l("reservesTitle")} padded={false}>
        <Table
          caption={l("reservesCaption")}
          columns={reserveColumns}
          rows={loaded.reserves}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("paymentsTitle")} padded={false}>
        <Table
          caption={l("paymentsCaption")}
          columns={paymentColumns}
          rows={loaded.payments}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("none")} />}
        />
      </Card>

      <Card title={l("recoveriesTitle")} padded={false}>
        <Table
          caption={l("recoveriesCaption")}
          columns={recoveryColumns}
          rows={loaded.recoveries}
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
