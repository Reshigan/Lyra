// docs/19 §2–§4. The transaction envelope, the state machine and the catalogue.
// The catalogue is data, not code paths: a new transaction type is a row here
// plus a recipe in recipes.ts, never a new branch in the engine.

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

/** docs/19 §3. Anything not listed is rejected — no ad-hoc state jumps. */
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

export function canTransition(from: TxnState, to: TxnState): boolean {
  return TRANSITIONS[from].includes(to);
}

export type ActorKind = "user" | "agent" | "partner" | "system" | "customer";

export interface TxnTypeDef {
  code: string;
  /** false = ⊘ in docs/19 §4: the transaction is real, it just posts no journal. */
  financial: boolean;
  /** Approval policy key from packages/core/approvals, or null when none applies. */
  approval: string | null;
  /** Moves money out of the business — never auto-approved above threshold. */
  payout?: true;
  /** Touches segregated client money: dual control always (docs/19 §7). */
  clientMoney?: true;
}

/** docs/19 §4, complete. Codes are stable API surface (`POST /v1/txn/{type}`). */
export const TXN_TYPES: Record<string, TxnTypeDef> = def([
  // 4.1 distribution lifecycle
  ["QUOTE-REQ", false, null],
  ["QUOTE-PANEL", false, null],
  ["QUOTE-PRESENT", false, null],
  ["BIND", true, "axis.bind"],
  ["BIND-GROUP", true, "axis.bind_group"],
  ["ENDORSE", true, "axis.endorse"],
  // Inception, expiry, lapse and NTU move no money, but they are transactions
  // rather than column writes because `runTxn` is the only writer that produces
  // a reversible, idempotent, audited state hop — and a mis-fired scheduler has
  // to be reversible (design §B.1).
  ["INCEPT", false, null],
  ["EXPIRE", false, null],
  ["NTU", false, "axis.ntu"],
  ["CANCEL", true, "axis.cancel"],
  ["LAPSE", false, null],
  ["REINSTATE", true, "axis.reinstate"],
  // Renewal used to borrow `axis.bind`'s gate; its own key lets the renewal
  // threshold move without touching new business (design §B.3).
  ["RENEW", true, "axis.renew"],
  ["FNOL-REGISTER", false, null],
  ["CLAIM-SYNC", false, null],
  ["PARAM-TRIGGER", false, null],

  // 4.2 money in
  ["PREM-COLLECT", true, null],
  ["PREM-INSTALMENT", true, null],
  ["DEPOSIT-TAKE", true, null],
  ["PSP-SETTLE", true, null],
  ["CHARGEBACK", true, null],
  ["CHARGEBACK-WIN", true, null],

  // 4.3 money out
  ["PREM-REMIT", true, "ledger.remit", { payout: true, clientMoney: true }],
  ["REFUND-ISSUE", true, "ledger.refund", { payout: true }],
  ["PAYOUT-INSTRUCT", true, "ledger.payout", { payout: true }],
  ["RSHARE-SETL", true, "dist.settlement_run", { payout: true }],
  ["CREATOR-PAYOUT", true, "ledger.payout", { payout: true }],
  ["SUPPLIER-PAY", true, "ledger.payout", { payout: true }],

  // 4.4 earnings & accruals
  ["CMSN-ACCR", true, null],
  ["CMSN-SETL", true, null],
  ["CMSN-CLAWBACK", true, null],
  ["FEE-BROK", true, null],
  ["FEE-SERVICE", true, null],
  ["REFERRAL-QUAL", false, null],
  ["REFERRAL-SETL", true, null],
  ["FIN-CMSN", true, null],
  ["RSHARE-ACCR", true, null],
  ["AD-PLACEMENT", true, null],
  ["SURPLUS-DIST", true, "ledger.surplus"],

  // 4.5 subscriptions, usage & platform billing
  ["SUB-CREATE", false, null],
  ["SUB-INVOICE", true, null],
  ["SUB-RECOG", true, null],
  ["SUB-CHANGE", true, null],
  ["SUB-CANCEL", true, null],
  ["USAGE-METER", false, null],
  ["OVERAGE", true, null],
  ["SUCCESS-FEE", true, "ledger.success_fee"],
  ["DUNNING", false, null],
  ["CREDIT-NOTE", true, "ledger.credit_note", { payout: true }],

  // 4.6 client money & escrow
  ["CM-RECEIPT", true, null, { clientMoney: true }],
  ["CM-TRANSFER", true, "ledger.client_money_transfer", { clientMoney: true }],
  ["CM-RECON", false, null],
  ["CM-BREACH-FLAG", false, null],

  // 4.7 partner & embedded
  ["PARTNER-ONBOARD", false, "dist.partner_activate"],
  ["PARTNER-QUOTE", false, null],
  ["PARTNER-BIND", true, null],
  ["RSHARE-ADJUST", true, "dist.rshare_adjust"],
  ["EXT-INSTALL", false, null],
  ["EXT-RSHARE", true, null],

  // 4.8 marketing & content commerce
  ["MEDIA-COMMIT", false, "signal.budget_commit"],
  ["MEDIA-SPEND", true, null],
  ["BUDGET-MOVE", false, "signal.budget_move"],
  ["PUBLISH", false, null],
  ["BOOST", true, "signal.boost"],
  ["CREATOR-BRIEF", false, "signal.creator_brief"],
  ["CREATOR-VERIFY", false, null],

  // 4.9 data products & AI
  ["DPROD-SUB", false, null],
  ["DPROD-DELIVER", false, null],
  ["AI-CALL", false, null],
  ["AI-BUDGET-STOP", false, null],

  // 4.10 identity, consent & compliance
  ["CONSENT-GRANT", false, null],
  ["CONSENT-WITHDRAW", false, null],
  ["KYC-VERIFY", false, null],
  ["SANCTIONS-SCREEN", false, null],
  ["DISCLOSURE-PRESENT", false, null],
  ["APPROVAL-DECISION", false, null],
  ["DSAR-FULFIL", false, null],
  ["AUDIT-EXPORT", false, null],

  // 4.11 agentic commerce
  ["MANDATE-REGISTER", false, "core.mandate_register"],
  ["AGENT-QUOTE", false, null],
  ["AGENT-BIND", true, null],
  ["MANDATE-REVOKE", false, null]
]);

type Tuple = [string, boolean, string | null, Partial<TxnTypeDef>?];

function def(rows: Tuple[]): Record<string, TxnTypeDef> {
  const out: Record<string, TxnTypeDef> = {};
  for (const [code, financial, approval, extra] of rows) {
    out[code] = { code, financial, approval, ...extra };
  }
  return out;
}

export function txnType(code: string): TxnTypeDef {
  const t = TXN_TYPES[code];
  if (!t) throw new Error(`unknown transaction type ${code}`);
  return t;
}

/**
 * docs/19 §7: no tenant may auto-approve a type that touches client money or
 * pays money out. Enforced here so a settings screen cannot open a hole.
 */
export function autoApprovable(code: string): boolean {
  const t = txnType(code);
  return !t.payout && !t.clientMoney;
}
