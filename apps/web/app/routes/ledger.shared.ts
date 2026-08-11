// What the four bespoke ledger screens agree on: the state machine they may
import { humanise } from "../modules/spec";
import { vocabulary } from "../modules/vocabulary";
import { pseudoText } from "../i18n";
// offer, the invariant they must show, and the words they say it in.
//
// Nothing here computes money. `balanceCheck` sums what the API already posted
// so the screen can say out loud whether the batch foots — it never derives an
// amount, and it never decides that an unbalanced batch is fine.
//
// The web app cannot import @lyra/ledger (it would drag Drizzle into the
// worker bundle), so the machine below is a mirror. `ledger.shared.test.ts`
// pins it; if the package moves, that test is what should fail.

/* ------------------------------------------------------------ state machine */

/** Mirrors packages/ledger/src/types.ts TXN_STATES. */
export const TXN_STATES = [
  "initiated",
  "validated",
  "authorized",
  "executing",
  "pending_external",
  "settled",
  "reversing",
  "reversed",
  "adjusting",
  "adjusted",
  "failed",
  "rejected",
  "expired"
] as const;

export type TxnState = (typeof TXN_STATES)[number];

/** Mirrors packages/ledger/src/types.ts TRANSITIONS. */
export const TRANSITIONS: Record<TxnState, readonly TxnState[]> = {
  initiated: ["validated", "rejected", "failed"],
  validated: ["authorized", "rejected", "failed"],
  authorized: ["executing", "failed", "rejected"],
  executing: ["settled", "pending_external", "failed"],
  pending_external: ["executing", "failed", "expired"],
  settled: ["reversing", "adjusting"],
  reversing: ["reversed", "failed"],
  reversed: [],
  adjusting: ["adjusted", "failed"],
  adjusted: ["reversing"],
  failed: [],
  rejected: [],
  expired: []
};

export function isTxnState(value: string): value is TxnState {
  return (TXN_STATES as readonly string[]).includes(value);
}

/**
 * The legal hops out of a state. An operator picks from this list rather than
 * typing a state, so an illegal hop is never offered — the API refuses it with
 * a 409 either way, which is the authority; this is only the manners.
 */
export function nextStates(from: string): readonly TxnState[] {
  return isTxnState(from) ? TRANSITIONS[from] : [];
}

/* ------------------------------------------------------------- permissions */

/** Exactly the strings apps/api/src/routes/ledger.ts calls `require_` with. */
export const PERM = {
  txnsRead: "ledger:txns:read",
  txnsCreate: "ledger:txns:create",
  txnsAuthorize: "ledger:txns:authorize",
  txnsReverse: "ledger:txns:reverse",
  periodsRead: "ledger:periods:read",
  periodsClose: "ledger:periods:close",
  journalsRead: "ledger:journals:read",
  journalsPost: "ledger:journals:post",
  reconRead: "ledger:recon:read",
  reconRun: "ledger:recon:run",
  reconConfirm: "ledger:recon:confirm",
  approvalsRead: "core:approvals:read",
  auditRead: "core:audit:read"
} as const;

export interface TxnActions {
  /** States this actor may move the transaction to, right now. */
  transitions: readonly TxnState[];
  canReverse: boolean;
}

/**
 * What the actor may do to this transaction. Two gates, both real: the
 * permission the API enforces, and the state the machine allows. An action that
 * fails either one is absent from the screen, not disabled on it.
 *
 * Reversal is only legal from `settled` — packages/ledger/src/txn.ts throws a
 * conflict otherwise, and a reversal is a counter-entry, so there is nothing to
 * counter until money has actually posted.
 */
export function txnActions(held: ReadonlySet<string>, state: string): TxnActions {
  return {
    transitions: held.has(PERM.txnsAuthorize) ? nextStates(state) : [],
    canReverse: held.has(PERM.txnsReverse) && state === "settled"
  };
}

/* --------------------------------------------------------- the invariant */

export interface SidedLine {
  side: string;
  amountMinor: number;
}

export interface BalanceCheck {
  debitMinor: number;
  creditMinor: number;
  /** debits − credits. Zero, or the batch does not foot. */
  deltaMinor: number;
  balanced: boolean;
  lineCount: number;
}

/**
 * Σdebits = Σcredits over the lines the API returned. Amounts are always
 * positive and the side carries the sign (packages/db ledger_journal_lines), so
 * a line with an unrecognised side is counted into neither total and shows up
 * as a discrepancy rather than quietly vanishing.
 */
export function balanceCheck(lines: readonly SidedLine[]): BalanceCheck {
  let debitMinor = 0;
  let creditMinor = 0;
  for (const line of lines) {
    if (line.side === "debit") debitMinor += line.amountMinor;
    else if (line.side === "credit") creditMinor += line.amountMinor;
  }
  const deltaMinor = debitMinor - creditMinor;
  return {
    debitMinor,
    creditMinor,
    deltaMinor,
    // An empty batch is balanced at zero but has nothing in it; the caller
    // decides whether that is "no lines yet" or "a financial txn with none".
    balanced: deltaMinor === 0 && lines.every((l) => l.side === "debit" || l.side === "credit"),
    lineCount: lines.length
  };
}

/* -------------------------------------------------------------------- tone */

type Tone = "neutral" | "accent" | "success" | "danger" | "warning" | "info";

const TXN_TONE: Record<TxnState, Tone> = {
  initiated: "neutral",
  validated: "neutral",
  authorized: "info",
  executing: "info",
  pending_external: "warning",
  settled: "success",
  reversing: "warning",
  reversed: "danger",
  adjusting: "warning",
  adjusted: "info",
  failed: "danger",
  rejected: "danger",
  expired: "danger"
};

export function txnTone(state: string): Tone {
  return isTxnState(state) ? TXN_TONE[state] : "neutral";
}

export function periodTone(state: string): Tone {
  return state === "open" ? "success" : state === "soft_closed" ? "warning" : "neutral";
}

/* ------------------------------------------------------------- idempotency */

/**
 * Minted once per form render, server side, and carried in a hidden field. A
 * key the browser generates at submit time is a new key per press, which is
 * exactly the double-post the header is supposed to stop (CLAUDE.md §12).
 */
export function mintKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/* ------------------------------------------------------------------ labels */

// Local rather than app/i18n: those files are shared and these words are not.
// Same pattern as ledger-reports.tsx and conversation.tsx.
export const LABELS: Record<string, Record<string, string>> = {
  en: {
    /* shared */
    denied: "You do not have permission to see this.",
    deniedBody: "This screen needs {permission}. Ask an administrator if you should have it.",
    back: "Back",
    none: "—",
    apply: "Apply",
    reason: "Reason",
    reasonRequired: "A reason is required.",
    currency: "Currency",
    amount: "Amount",
    state: "State",
    when: "When",
    actor: "Actor",
    idempotencyNote: "This form carries a one-time key, so pressing twice posts once.",

    /* transaction detail */
    "txn.title": "Transaction",
    "txn.intro": "One transaction, its journal, and everything done to it.",
    "txn.type": "Type",
    "txn.gross": "Gross",
    "txn.correlation": "Correlation",
    "txn.parent": "Opened by",
    "txn.reversalOf": "Reverses",
    "txn.reversedBy": "Reversed by",
    "txn.failure": "Failure",
    "txn.key": "Idempotency key",
    "txn.batch": "Journal batch",
    "txn.lines": "Journal lines",
    "txn.linesCaption": "Journal lines posted by this transaction",
    "txn.noLines": "No journal lines",
    "txn.noLinesBody": "A non-financial transaction settles without a batch. Nothing was posted.",
    "txn.account": "Account",
    "txn.side": "Side",
    "txn.memo": "Memo",
    "txn.debit": "Debit",
    "txn.credit": "Credit",
    "txn.totalDebit": "Total debits",
    "txn.totalCredit": "Total credits",
    "txn.balanced": "Debits equal credits.",
    "txn.imbalance": "This batch does not balance",
    "txn.imbalanceBody":
      "Debits and credits differ by the amount above. Double entry says they cannot. Do not act on this transaction — send the batch id to finance engineering.",
    "txn.history": "History",
    "txn.historyLabel": "State changes",
    "txn.approvals": "Approvals",
    "txn.approvalsEmpty": "Nothing about this transaction has needed an approval.",
    "txn.approvalsInbox": "Open the approvals queue",
    "txn.audit": "Audit trail",
    "txn.auditEmpty": "Nothing has happened to this transaction yet.",
    "txn.transition": "Move state",
    "txn.transitionTo": "Move to",
    "txn.transitionSubmit": "Move",
    "txn.transitionNone": "No move is legal from this state.",
    "txn.failureCode": "Failure code",
    "txn.reverse": "Reverse",
    "txn.reverseBody":
      "A reversal does not delete anything. It opens a second transaction that posts the opposite journal and leaves both on the record.",
    "txn.reverseSubmit": "Reverse this transaction",
    "txn.reverseConfirm": "Reverse this transaction? A counter-entry will be posted and both remain on the record.",
    "txn.approvalRaised": "Approval requested",
    "txn.approvalRaisedBody":
      "Nothing has happened yet. The request is waiting in the approvals queue for someone who may decide it.",
    "txn.moved": "Moved to {state}.",
    "txn.reversedAs": "Reversal posted as {id}.",
    "txn.statement": "Open the account statement",

    /* opening a transaction */
    "open.title": "Open a transaction",
    "open.intro":
      "Money moves by running a transaction type. Pick the type, give it its arguments, and the ledger posts the recipe.",
    "open.type": "Transaction type",
    "open.financial": "Posts a journal",
    "open.nonFinancial": "No journal",
    "open.approval": "Needs approval",
    "open.payout": "Money out",
    "open.clientMoney": "Client money",
    "open.key": "Transaction key",
    "open.keyHint": "The natural key for this transaction. Reusing it returns the same transaction.",
    "open.gross": "Gross amount",
    "open.args": "Arguments",
    "open.argsHint":
      "JSON the recipe expects. The ledger validates it and names the fields it wanted if any are missing.",
    "open.submit": "Open transaction",
    "open.confirm": "Open this transaction? It posts to the ledger.",
    "open.opened": "Transaction opened",
    "open.catalogue": "Type catalogue",
    "open.catalogueCaption": "Transaction types this tenant can run",
    "open.code": "Code",
    "open.openedAs": "Opened as {id}.",
    "open.openRecord": "Open it",
    "open.argsInvalid": "Arguments must be a JSON object.",

    /* periods */
    "period.title": "Period close",
    "period.intro":
      "A period closes when its checks pass. Soft close first: it stops ordinary posting and still allows an adjustment with a reason.",
    "period.code": "Period",
    "period.checks": "Checks",
    "period.checksCaption": "Close checks for this period",
    "period.check": "Check",
    "check.trial_balance_zero": "Debits equal credits",
    "check.batches_match_lines": "Every batch agrees with its lines",
    "check.no_pending_external": "Nothing still waiting on a provider",
    "check.no_open_client_money_breach": "No open client-money breach",
    "period.detail": "Detail",
    "period.ok": "Pass",
    "period.fail": "Fail",
    "period.blocked": "This period cannot close yet",
    "period.blockedBody": "The checks below have not passed. Fix what they name, then close.",
    "period.closedBy": "Closed by",
    "period.closedNow": "Period {code} is now {state}.",
    "period.reopened": "Period {code} is open again.",
    "period.close": "Close",
    "period.closeSoft": "Soft close",
    "period.closeHard": "Hard close",
    "period.closeSoftConfirm": "Soft close this period? Ordinary posting stops; adjustments with a reason still post.",
    "period.closeHardConfirm": "Hard close this period? Only contra entries post afterwards.",
    "period.reopen": "Reopen",
    "period.reopenConfirm": "Reopen this period? Posting resumes and the close is undone.",
    "period.recent": "Periods",
    "period.recentCaption": "Recent accounting periods",
    "period.noneRecent": "No periods have been closed yet.",
    "period.noneSelected": "No period chosen.",
    "period.noneSelectedBody":
      "Pick a period from the list below, or look one up by code, to see its checks and close it.",
    "period.lookup": "Look up a period",
    "period.rebuild": "Check balances against the journal",
    "period.rebuildBody":
      "The journal is the truth and the balances table is a cache derived from it. This re-reads every line and reports where the two disagree. It writes nothing and moves no money — it is the answer to a check that argues with the journal.",
    "period.rebuildConfirm":
      "Re-read the whole journal? Nothing is written, but on a large ledger this takes a while.",
    "period.rebuildSubmit": "Run the check",
    "period.checked": "Checked {count} balances. Every one agrees with the journal.",
    "period.driftTable": "Balance check",
    "period.driftCaption": "Stored balances compared against the journal",
    "period.driftedTitle": "{count} of {total} balances disagree with the journal",
    "period.driftedBody":
      "The stored balance and the journal differ on the accounts below. The journal is the truth: nothing here has changed money, and no close should be forced until these agree.",
    "period.driftOnly": "Only the accounts that disagree are listed.",
    "period.stored": "Stored",
    "period.rebuiltCol": "From the journal",

    /* account statement */
    "account.title": "Account statement",
    "account.intro": "Every line posted to this account, with the balance it left behind.",
    "account.code": "Account",
    "account.opening": "Opening",
    "account.closing": "Closing",
    "account.balance": "Cached balance",
    "account.from": "From",
    "account.to": "To",
    "account.lookup": "Look up an account",
    "account.hint": "Account code from the chart of accounts, e.g. 1000",
    "account.pick": "Pick an account",
    "account.browse": "Browse the chart of accounts",
    "account.pickBody": "Enter an account code above to read its statement.",
    "account.lines": "Statement",
    "account.linesCaption": "Journal lines for this account",
    "account.running": "Running",
    "account.txn": "Transaction",
    "account.empty": "No lines in this window",
    "account.emptyBody": "Nothing posted to this account between these dates.",
    "account.drift": "The cached balance disagrees with the journal",
    "account.driftBody":
      "The statement closes on one figure and the balance cache holds another. The journal is the truth. Rebuild the cache from the period close screen.",

    /* reconciliation */
    "recon.title": "Reconciliation",
    "recon.intro":
      "Match a counterparty statement against what we settled. Nothing posts here — a match is a judgement, and it is recorded as one.",
    "recon.process": "Process",
    "recon.period": "Period",
    "recon.counterparty": "Counterparty",
    "recon.counterpartyHint": "The insurer, partner or provider id this statement came from. Leave it blank to match the whole period.",
    "recon.tolerance": "Tolerance",
    "recon.propose": "Let the assistant propose matches for the leftovers",
    "recon.proposeHint": "Proposals are never posted. Each one still needs a person to confirm it.",
    "recon.lines": "Statement lines",
    "recon.linesHint": "One JSON array: ref, amountMinor, currency, and optionally ourRef, postedAt, description.",
    "recon.start": "Start run",
    "recon.startConfirm": "Start this reconciliation run?",
    "recon.runs": "Runs",
    "recon.runsCaption": "Recent reconciliation runs",
    "recon.noRuns": "No reconciliation runs yet.",
    "recon.run": "Run",
    "recon.matched": "Matched",
    "recon.variance": "Variance",
    "recon.varianceMinor": "Variance amount",
    "recon.open": "Awaiting a decision",
    "recon.matches": "Matches",
    "recon.matchesCaption": "Proposed and decided matches in this run",
    "recon.statementRef": "Statement line",
    "recon.txn": "Transaction",
    "recon.delta": "Delta",
    "recon.method": "How",
    "recon.confidence": "Confidence",
    "recon.decidedBy": "Decided by",
    "recon.decide": "Decide",
    "recon.confirm": "Confirm",
    "recon.reject": "Reject",
    "recon.reasonCode": "Why",
    "recon.reasonCodeHint": "Recorded against your name on the match. Say what convinced you.",
    "recon.confirmConfirm": "Confirm this match? Your name and reason go on the record.",
    "recon.rejectConfirm": "Reject this match? Your name and reason go on the record.",
    "recon.noMatches": "No matches yet",
    "recon.noMatchesBody": "This run produced nothing to decide.",
    "recon.aiProposed": "Proposed by the assistant",
    "recon.lookup": "Open a run",
    "recon.runId": "Run id",
    "recon.started": "Run {id} started: {matched} matched, {variances} with a variance.",
    "recon.decided": "Match recorded as {decision}.",
    "recon.pick": "Pick a run",
    "recon.pickBody": "Start a run above, or open one by its id.",
    "recon.linesInvalid": "Statement lines must be a JSON array.",
    "recon.unmatched": "Unmatched",
    "recon.unmatchedRefs": "Statement lines with no transaction",
    "recon.unmatchedTxns": "Transactions with no statement line",

    /* method / process / decision vocabulary */
    "method.deterministic": "Exact",
    "method.tolerance": "Within tolerance",
    "method.ai_proposed": "Assistant",
    "process.insurer": "Insurer",
    "process.psp": "Payment provider",
    "process.client_money": "Client money",
    "process.partner": "Partner",
    "process.media": "Media",
    "match.proposed": "Proposed",
    "match.confirmed": "Confirmed",
    "match.rejected": "Rejected",
    "match.unmatched": "Unmatched",
    "side.debit": "Debit",
    "side.credit": "Credit",
    "state.open": "Open",
    "state.soft_closed": "Soft closed",
    "state.hard_closed": "Hard closed",
    "state.running": "Running",
    "state.review": "Review",
    "state.closed": "Closed",
    "state.initiated": "Initiated",
    "state.validated": "Validated",
    "state.authorized": "Authorized",
    "state.executing": "Executing",
    "state.pending_external": "Waiting on a third party",
    "state.settled": "Settled",
    "state.reversing": "Reversing",
    "state.reversed": "Reversed",
    "state.adjusting": "Adjusting",
    "state.adjusted": "Adjusted",
    "state.failed": "Failed",
    "state.rejected": "Rejected",
    "state.expired": "Expired"
  },

  ar: {
    denied: "ليس لديك إذن لعرض هذه الشاشة.",
    deniedBody: "تحتاج هذه الشاشة إلى {permission}. راجع المسؤول إن كان ينبغي أن تملكه.",
    back: "رجوع",
    none: "—",
    apply: "تطبيق",
    reason: "السبب",
    reasonRequired: "السبب مطلوب.",
    currency: "العملة",
    amount: "المبلغ",
    state: "الحالة",
    when: "الوقت",
    actor: "المنفّذ",
    idempotencyNote: "يحمل هذا النموذج مفتاحًا لمرة واحدة، فالضغط مرتين يُرسل مرة واحدة.",

    "txn.title": "المعاملة",
    "txn.intro": "معاملة واحدة، وقيودها، وكل ما جرى عليها.",
    "txn.type": "النوع",
    "txn.gross": "الإجمالي",
    "txn.correlation": "معرّف الارتباط",
    "txn.parent": "فتحتها",
    "txn.reversalOf": "تعكس",
    "txn.reversedBy": "عُكست بواسطة",
    "txn.failure": "سبب الفشل",
    "txn.key": "مفتاح عدم التكرار",
    "txn.batch": "دفعة القيود",
    "txn.lines": "سطور القيد",
    "txn.linesCaption": "سطور القيد التي رحّلتها هذه المعاملة",
    "txn.noLines": "لا توجد سطور قيد",
    "txn.noLinesBody": "المعاملة غير المالية تُسوّى دون دفعة قيود. لم يُرحّل شيء.",
    "txn.account": "الحساب",
    "txn.side": "الجانب",
    "txn.memo": "البيان",
    "txn.debit": "مدين",
    "txn.credit": "دائن",
    "txn.totalDebit": "إجمالي المدين",
    "txn.totalCredit": "إجمالي الدائن",
    "txn.balanced": "المدين يساوي الدائن.",
    "txn.imbalance": "هذه الدفعة غير متوازنة",
    "txn.imbalanceBody":
      "يختلف المدين عن الدائن بالمقدار أعلاه، والقيد المزدوج لا يسمح بذلك. لا تتصرّف بهذه المعاملة وأبلغ الهندسة المالية بمعرّف الدفعة.",
    "txn.history": "السجل",
    "txn.historyLabel": "تغيّرات الحالة",
    "txn.approvals": "الموافقات",
    "txn.approvalsEmpty": "لم يحتج أي إجراء على هذه المعاملة إلى موافقة.",
    "txn.approvalsInbox": "فتح قائمة الموافقات",
    "txn.audit": "سجل التدقيق",
    "txn.auditEmpty": "لم يحدث شيء لهذه المعاملة بعد.",
    "txn.transition": "تغيير الحالة",
    "txn.transitionTo": "الانتقال إلى",
    "txn.transitionSubmit": "نقل",
    "txn.transitionNone": "لا يوجد انتقال مسموح من هذه الحالة.",
    "txn.failureCode": "رمز الفشل",
    "txn.reverse": "عكس",
    "txn.reverseBody":
      "العكس لا يحذف شيئًا، بل يفتح معاملة ثانية تُرحّل القيد المعاكس وتبقى الاثنتان في السجل.",
    "txn.reverseSubmit": "عكس هذه المعاملة",
    "txn.reverseConfirm": "هل تعكس هذه المعاملة؟ سيُرحّل قيد معاكس وتبقى الاثنتان في السجل.",
    "txn.approvalRaised": "طُلبت موافقة",
    "txn.approvalRaisedBody":
      "لم يحدث شيء بعد. الطلب في انتظار من يملك البتّ فيه ضمن قائمة الموافقات.",
    "txn.moved": "انتقلت إلى {state}.",
    "txn.reversedAs": "رُحّل القيد العكسي بالمعرّف {id}.",
    "txn.statement": "فتح كشف الحساب",

    "open.title": "فتح معاملة",
    "open.intro": "المال يتحرك بتشغيل نوع معاملة. اختر النوع وأدخل معاملاته، ويُرحّل الدفتر الوصفة.",
    "open.type": "نوع المعاملة",
    "open.financial": "تُرحّل قيدًا",
    "open.nonFinancial": "بلا قيد",
    "open.approval": "تحتاج موافقة",
    "open.payout": "صرف",
    "open.clientMoney": "أموال العملاء",
    "open.key": "مفتاح المعاملة",
    "open.keyHint": "المفتاح الطبيعي لهذه المعاملة. إعادة استخدامه تُعيد المعاملة نفسها.",
    "open.gross": "المبلغ الإجمالي",
    "open.args": "المعاملات",
    "open.argsHint": "قيمة JSON تتوقعها الوصفة. يتحقق الدفتر منها ويسمّي الحقول الناقصة.",
    "open.submit": "فتح المعاملة",
    "open.confirm": "هل تفتح هذه المعاملة؟ سيتم الترحيل إلى الدفتر.",
    "open.opened": "فُتحت المعاملة",
    "open.catalogue": "دليل الأنواع",
    "open.catalogueCaption": "أنواع المعاملات المتاحة لهذه المؤسسة",
    "open.code": "الرمز",
    "open.openedAs": "فُتحت بالمعرّف {id}.",
    "open.openRecord": "فتحها",
    "open.argsInvalid": "يجب أن تكون المعاملات كائن JSON.",

    "period.title": "إقفال الفترة",
    "period.intro":
      "تُقفل الفترة عندما تنجح فحوصها. ابدأ بالإقفال المبدئي: يوقف الترحيل الاعتيادي ويسمح بالتسويات المسبّبة.",
    "period.code": "الفترة",
    "period.checks": "الفحوص",
    "period.checksCaption": "فحوص إقفال هذه الفترة",
    "period.check": "الفحص",
    "check.trial_balance_zero": "المدين يساوي الدائن",
    "check.batches_match_lines": "كل دفعة تطابق سطورها",
    "check.no_pending_external": "لا شيء ينتظر مزوّدًا",
    "check.no_open_client_money_breach": "لا مخالفة مفتوحة في أموال العملاء",
    "period.detail": "التفصيل",
    "period.ok": "ناجح",
    "period.fail": "فاشل",
    "period.blocked": "لا يمكن إقفال هذه الفترة بعد",
    "period.blockedBody": "لم تنجح الفحوص أدناه. عالج ما تشير إليه ثم أقفل.",
    "period.closedBy": "أقفلها",
    "period.closedNow": "الفترة {code} أصبحت {state}.",
    "period.reopened": "الفترة {code} مفتوحة من جديد.",
    "period.close": "إقفال",
    "period.closeSoft": "إقفال مبدئي",
    "period.closeHard": "إقفال نهائي",
    "period.closeSoftConfirm": "إقفال مبدئي لهذه الفترة؟ يتوقف الترحيل الاعتيادي وتبقى التسويات المسبّبة ممكنة.",
    "period.closeHardConfirm": "إقفال نهائي لهذه الفترة؟ لن تُرحّل بعده إلا القيود العكسية.",
    "period.reopen": "إعادة فتح",
    "period.reopenConfirm": "إعادة فتح هذه الفترة؟ يستأنف الترحيل ويُلغى الإقفال.",
    "period.recent": "الفترات",
    "period.recentCaption": "الفترات المحاسبية الأخيرة",
    "period.noneRecent": "لم يتم إقفال أي فترة بعد.",
    "period.noneSelected": "لم يتم اختيار فترة.",
    "period.noneSelectedBody":
      "اختر فترة من القائمة أدناه، أو ابحث عنها بالرمز، لعرض فحوصها وإقفالها.",
    "period.lookup": "بحث عن فترة",
    "period.rebuild": "مطابقة الأرصدة مع الدفتر",
    "period.rebuildBody":
      "الدفتر هو المصدر وجدول الأرصدة نسخة مشتقة منه. هذا الفحص يقرأ كل السطور ويبيّن مواضع الاختلاف. لا يكتب شيئًا ولا يحرّك مالًا، وهو الجواب على فحص يخالف الدفتر.",
    "period.rebuildConfirm": "هل تُعاد قراءة الدفتر كاملًا؟ لا يُكتب شيء، لكن الأمر قد يستغرق وقتًا.",
    "period.rebuildSubmit": "تشغيل الفحص",
    "period.checked": "فُحص {count} رصيدًا، وكلها مطابقة للدفتر.",
    "period.driftTable": "فحص الأرصدة",
    "period.driftCaption": "مقارنة الأرصدة المخزّنة بالدفتر",
    "period.driftedTitle": "{count} من {total} رصيدًا تخالف الدفتر",
    "period.driftedBody":
      "الرصيد المخزّن يختلف عن الدفتر في الحسابات أدناه. الدفتر هو المصدر: لم يتغيّر أي مال هنا، ولا ينبغي فرض الإقفال قبل تطابقها.",
    "period.driftOnly": "تُعرض الحسابات المختلفة فقط.",
    "period.stored": "المخزّن",
    "period.rebuiltCol": "من الدفتر",

    "account.title": "كشف حساب",
    "account.intro": "كل سطر رُحّل إلى هذا الحساب والرصيد الذي تركه.",
    "account.code": "الحساب",
    "account.opening": "الرصيد الافتتاحي",
    "account.closing": "الرصيد الختامي",
    "account.balance": "الرصيد المخزّن",
    "account.from": "من",
    "account.to": "إلى",
    "account.lookup": "بحث عن حساب",
    "account.hint": "رقم الحساب من دليل الحسابات، مثال 1000",
    "account.pick": "اختر حسابًا",
    "account.browse": "تصفّح دليل الحسابات",
    "account.pickBody": "أدخل رقم الحساب أعلاه لعرض كشفه.",
    "account.lines": "الكشف",
    "account.linesCaption": "سطور القيد لهذا الحساب",
    "account.running": "الرصيد الجاري",
    "account.txn": "المعاملة",
    "account.empty": "لا سطور في هذه الفترة",
    "account.emptyBody": "لم يُرحّل شيء إلى هذا الحساب بين هذين التاريخين.",
    "account.drift": "الرصيد المخزّن يخالف الدفتر",
    "account.driftBody":
      "يُقفل الكشف على رقم ويحمل المخزون رقمًا آخر. الدفتر هو المصدر. أعد بناء المخزون من شاشة إقفال الفترة.",

    "recon.title": "التسوية",
    "recon.intro": "طابق كشف الطرف المقابل مع ما سوّيناه. لا ترحيل هنا — المطابقة حكم، وتُسجّل كذلك.",
    "recon.process": "العملية",
    "recon.period": "الفترة",
    "recon.counterparty": "الطرف المقابل",
    "recon.counterpartyHint": "معرّف شركة التأمين أو الشريك أو المزوّد الذي جاء منه هذا الكشف. اتركه فارغًا لمطابقة الفترة كاملة.",
    "recon.tolerance": "حد التسامح",
    "recon.propose": "دع المساعد يقترح مطابقات للمتبقّي",
    "recon.proposeHint": "الاقتراحات لا تُرحّل أبدًا، ويظل كل اقتراح بحاجة إلى تأكيد شخص.",
    "recon.lines": "سطور الكشف",
    "recon.linesHint": "مصفوفة JSON واحدة: ref و amountMinor و currency، واختياريًا ourRef و postedAt و description.",
    "recon.start": "بدء التشغيل",
    "recon.startConfirm": "هل تبدأ هذه التسوية؟",
    "recon.runs": "عمليات التشغيل",
    "recon.runsCaption": "أحدث عمليات التسوية",
    "recon.noRuns": "لا توجد عمليات تسوية بعد.",
    "recon.run": "التشغيل",
    "recon.matched": "مطابَق",
    "recon.variance": "فروقات",
    "recon.varianceMinor": "مبلغ الفروقات",
    "recon.open": "بانتظار قرار",
    "recon.matches": "المطابقات",
    "recon.matchesCaption": "المطابقات المقترحة والمقرّرة في هذا التشغيل",
    "recon.statementRef": "سطر الكشف",
    "recon.txn": "المعاملة",
    "recon.delta": "الفرق",
    "recon.method": "الطريقة",
    "recon.confidence": "الثقة",
    "recon.decidedBy": "قرّرها",
    "recon.decide": "قرار",
    "recon.confirm": "تأكيد",
    "recon.reject": "رفض",
    "recon.reasonCode": "السبب",
    "recon.reasonCodeHint": "يُسجَّل باسمك على المطابقة. اذكر ما أقنعك.",
    "recon.confirmConfirm": "تأكيد هذه المطابقة؟ سيُسجَّل اسمك وسببك.",
    "recon.rejectConfirm": "رفض هذه المطابقة؟ سيُسجَّل اسمك وسببك.",
    "recon.noMatches": "لا مطابقات بعد",
    "recon.noMatchesBody": "لم يُنتج هذا التشغيل ما يُقرَّر فيه.",
    "recon.aiProposed": "اقترحه المساعد",
    "recon.lookup": "فتح تشغيل",
    "recon.runId": "معرّف التشغيل",
    "recon.started": "بدأ التشغيل {id}: {matched} مطابقة و{variances} فرقًا.",
    "recon.decided": "سُجّلت المطابقة على أنها {decision}.",
    "recon.pick": "اختر تشغيلًا",
    "recon.pickBody": "ابدأ تشغيلًا أعلاه أو افتح واحدًا بمعرّفه.",
    "recon.linesInvalid": "يجب أن تكون سطور الكشف مصفوفة JSON.",
    "recon.unmatched": "غير مطابق",
    "recon.unmatchedRefs": "سطور كشف بلا معاملة",
    "recon.unmatchedTxns": "معاملات بلا سطر كشف",

    "method.deterministic": "مطابقة تامة",
    "method.tolerance": "ضمن حد التسامح",
    "method.ai_proposed": "المساعد",
    "process.insurer": "شركة التأمين",
    "process.psp": "مزوّد الدفع",
    "process.client_money": "أموال العملاء",
    "process.partner": "الشريك",
    "process.media": "الإعلام",
    "match.proposed": "مقترحة",
    "match.confirmed": "مؤكدة",
    "match.rejected": "مرفوضة",
    "match.unmatched": "غير مطابقة",
    "side.debit": "مدين",
    "side.credit": "دائن",
    "state.open": "مفتوحة",
    "state.soft_closed": "مقفلة مبدئيًا",
    "state.hard_closed": "مقفلة نهائيًا",
    "state.running": "قيد التشغيل",
    "state.review": "قيد المراجعة",
    "state.closed": "مقفلة",
    "state.initiated": "بدأت",
    "state.validated": "تم التحقق",
    "state.authorized": "مُصرّح بها",
    "state.executing": "قيد التنفيذ",
    "state.pending_external": "بانتظار طرف ثالث",
    "state.settled": "مسوّاة",
    "state.reversing": "قيد العكس",
    "state.reversed": "معكوسة",
    "state.adjusting": "قيد التسوية",
    "state.adjusted": "مسوّاة تعديليًا",
    "state.failed": "فشلت",
    "state.rejected": "مرفوضة",
    "state.expired": "منتهية"
  }
};

export type Label = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The pack answers first (CLAUDE.md §14): `process.insurer` is an industry noun
 * and a tenant selling something else calls that counterparty a supplier. Every
 * other key here is platform vocabulary, which no pack has an opinion on, so
 * the consult costs one lookup and changes nothing for the default pack.
 */
export function labelIn(locale: string, pack?: string): Label {
  const table = LABELS[locale] ?? LABELS.en!;
  const packed = vocabulary(pack, locale);
  return (key, vars) => {
    const text = pseudoText(locale, packed(key) ?? table[key] ?? LABELS.en![key] ?? key);
    return vars
      ? text.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole))
      : text;
  };
}

/**
 * A close check as the accountant reading it says it. The ledger names checks
 * for itself — `no_pending_external@2026-08` — and the close screen printed
 * exactly that, key, period suffix and all, in the blocking banner and in every
 * row of the checks table. The period is already the heading above both.
 */
export function checkName(name: string, l: Label): string {
  const key = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
  const said = l(`check.${key}`);
  return said === `check.${key}` ? humanise(key) : said;
}
