import { and, desc, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { approvalRequired, badRequest, conflict, internal, notFound } from "./errors.js";
import { audit } from "./audit.js";
import { emit, type MODULES } from "./events.js";
import { actorRef, type Ctx } from "./context.js";
import { can, type Permission } from "./rbac.js";

// docs/19 §7 + docs/12 §4. One engine; AXIS and the ledger are the heavy users.

export type DualControl = "never" | "above_threshold" | "always";

export interface ApprovalPolicy {
  key: string;
  module: (typeof MODULES)[number];
  /** Permission a decider must hold. */
  decide: Permission;
  dualControl: DualControl;
  /** Minor units. At or above this, dual control applies when `above_threshold`. */
  defaultThresholdMinor?: number;
  /**
   * docs/19 §7: "No transaction type may be added to a tenant's auto-approve
   * allowlist if it debits client money, issues a payout, or crosses a
   * regulatory floor." These ignore `policy.autoApprove` entirely.
   */
  neverAutoApprove?: true;
}

function policy(p: ApprovalPolicy): ApprovalPolicy {
  return p;
}

export const APPROVAL_POLICIES: Record<string, ApprovalPolicy> = Object.fromEntries(
  [
    // money
    policy({ key: "ledger.refund", module: "ledger", decide: "ledger:payments:refund", dualControl: "above_threshold", defaultThresholdMinor: 500_00 }),
    policy({ key: "ledger.payout", module: "ledger", decide: "ledger:payouts:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.client_money_transfer", module: "ledger", decide: "ledger:client_money:transfer", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.partner_settlement", module: "ledger", decide: "ledger:payouts:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.success_fee", module: "ledger", decide: "ledger:invoices:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.period_close", module: "ledger", decide: "ledger:periods:close", dualControl: "above_threshold" }),
    policy({ key: "ledger.manual_journal", module: "ledger", decide: "ledger:journals:post", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.remit", module: "ledger", decide: "ledger:client_money:transfer", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.surplus", module: "ledger", decide: "ledger:payouts:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ledger.credit_note", module: "ledger", decide: "ledger:invoices:approve", dualControl: "above_threshold", defaultThresholdMinor: 1_000_00, neverAutoApprove: true }),
    // operations
    policy({ key: "axis.case_issue", module: "axis", decide: "axis:cases:approve", dualControl: "above_threshold", defaultThresholdMinor: 50_000_00 }),
    policy({ key: "axis.price_match", module: "axis", decide: "axis:quotes:approve", dualControl: "above_threshold", defaultThresholdMinor: 1_000_00 }),
    policy({ key: "axis.claim_settlement", module: "axis", decide: "axis:claims:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "axis.escrow_release", module: "axis", decide: "axis:escrow:approve", dualControl: "always", neverAutoApprove: true }),
    // policy lifecycle — a bind is a contract with a customer, so it is gated even
    // when small; the threshold only decides whether a second pair of eyes is needed.
    policy({ key: "axis.bind", module: "axis", decide: "axis:policies:create", dualControl: "above_threshold", defaultThresholdMinor: 250_000_00 }),
    policy({ key: "axis.bind_group", module: "axis", decide: "axis:policies:create", dualControl: "above_threshold", defaultThresholdMinor: 100_000_00 }),
    policy({ key: "axis.endorse", module: "axis", decide: "axis:policies:update", dualControl: "above_threshold", defaultThresholdMinor: 25_000_00 }),
    policy({ key: "axis.cancel", module: "axis", decide: "axis:policies:cancel", dualControl: "never" }),
    policy({ key: "axis.reinstate", module: "axis", decide: "axis:policies:update", dualControl: "never" }),
    // distribution — commercial terms with a counterparty, so a second pair of eyes
    policy({ key: "dist.rate_change", module: "core", decide: "dist:rates:approve", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "dist.commission_adjust", module: "core", decide: "dist:commissions:adjust", dualControl: "above_threshold", defaultThresholdMinor: 1_000_00 }),
    policy({ key: "dist.offering_publish", module: "core", decide: "dist:offerings:publish", dualControl: "never" }),
    policy({ key: "dist.settlement_run", module: "core", decide: "dist:commissions:settle", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "dist.partner_activate", module: "core", decide: "orbit:partners:certify", dualControl: "never" }),
    policy({ key: "dist.rshare_adjust", module: "core", decide: "dist:commissions:adjust", dualControl: "above_threshold", defaultThresholdMinor: 1_000_00 }),
    // growth
    policy({ key: "signal.budget_move", module: "signal", decide: "signal:budget_moves:approve", dualControl: "never" }),
    policy({ key: "signal.campaign_launch", module: "signal", decide: "signal:campaigns:launch", dualControl: "never" }),
    policy({ key: "signal.creative_publish", module: "signal", decide: "signal:creatives:approve", dualControl: "never" }),
    policy({ key: "signal.budget_commit", module: "signal", decide: "signal:campaigns:launch", dualControl: "above_threshold", defaultThresholdMinor: 50_000_00 }),
    policy({ key: "signal.boost", module: "signal", decide: "signal:campaigns:update", dualControl: "never" }),
    policy({ key: "signal.creator_brief", module: "signal", decide: "signal:creatives:approve", dualControl: "never" }),
    // governance
    policy({ key: "core.impersonate", module: "core", decide: "core:impersonate:use", dualControl: "always", neverAutoApprove: true }),
    // A mandate is delegated spending authority handed to an agent, so it is
    // issued under the same permission as a live credential.
    policy({ key: "core.mandate_register", module: "core", decide: "core:api_keys:create", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "core.unmasked_export", module: "core", decide: "analytics:exports:unmasked", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "compliance.erasure", module: "core", decide: "compliance:erasure:execute", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "compliance.legal_hold_release", module: "core", decide: "compliance:legal_holds:write", dualControl: "always", neverAutoApprove: true }),
    // ai
    policy({ key: "ai.autonomy_raise", module: "ai", decide: "ai:agents:write", dualControl: "always", neverAutoApprove: true }),
    policy({ key: "ai.prompt_publish", module: "ai", decide: "ai:prompts:write", dualControl: "never" }),
    policy({ key: "ai.budget_raise", module: "ai", decide: "ai:budgets:write", dualControl: "above_threshold" })
  ].map((p) => [p.key, p])
);

/** An approval is spent within this window; after it, ask again. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApprovalRow {
  id: string;
  tenantId: string;
  subjectRef: string;
  policyKey: string;
  module: string;
  requestedBy: string;
  requestedAt: number;
  decidedBy: string | null;
  decision: string;
  reason: string | null;
  contextJson: string | null;
  decidedAt: number | null;
}

export interface GateInput {
  policyKey: string;
  subjectRef: string;
  /** Drives threshold-based dual control. */
  amountMinor?: number;
  context?: Record<string, unknown>;
}

function needsDualControl(p: ApprovalPolicy, amountMinor: number | undefined): boolean {
  if (p.dualControl === "always") return true;
  if (p.dualControl === "never") return false;
  const threshold = p.defaultThresholdMinor ?? 0;
  return (amountMinor ?? 0) >= threshold;
}

/**
 * Gate a consequential action. Returns the approval that authorises it, or
 * `null` when the tenant has auto-approved this policy. Throws 403
 * approval_required when one must be obtained — creating the pending record
 * as a side effect so the UI has something to show.
 */
export async function gate(ctx: Ctx, input: GateInput): Promise<ApprovalRow | null> {
  const p = APPROVAL_POLICIES[input.policyKey];
  if (!p) throw internal(`unknown approval policy ${input.policyKey}`);

  if (!p.neverAutoApprove && ctx.policy.autoApprove.includes(p.key)) {
    await audit(ctx, {
      action: "core.approval.auto",
      subjectRef: input.subjectRef,
      after: { policyKey: p.key, amountMinor: input.amountMinor }
    });
    return null;
  }

  const existing = await ctx.db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.tenantId, ctx.tenantId),
        eq(schema.approvals.subjectRef, input.subjectRef),
        eq(schema.approvals.policyKey, p.key)
      )
    )
    .orderBy(desc(schema.approvals.requestedAt))
    .limit(1);

  const row = existing[0] as ApprovalRow | undefined;
  if (row?.decision === "approved" && row.decidedAt != null) {
    if (ctx.now - row.decidedAt <= APPROVAL_TTL_MS) return row;
    // Stale: fall through and ask again.
  }
  if (row?.decision === "pending") throw approvalRequired(p.key, row.id);
  if (row?.decision === "rejected" && ctx.now - (row.decidedAt ?? 0) <= APPROVAL_TTL_MS) {
    throw approvalRequired(p.key, row.id);
  }

  const created: ApprovalRow = {
    id: newId("apr", ctx.now),
    tenantId: ctx.tenantId,
    subjectRef: input.subjectRef,
    policyKey: p.key,
    module: p.module,
    requestedBy: actorRef(ctx),
    requestedAt: ctx.now,
    decidedBy: null,
    decision: "pending",
    reason: null,
    contextJson: JSON.stringify({
      ...(input.context ?? {}),
      amountMinor: input.amountMinor ?? null,
      dualControl: needsDualControl(p, input.amountMinor)
    }),
    decidedAt: null
  };
  await ctx.db.insert(schema.approvals).values(created);
  await audit(ctx, { action: "core.approval.requested", subjectRef: input.subjectRef, after: created });
  await emit(ctx, {
    module: p.module,
    type: `${p.module}.approval.requested`,
    subject: input.subjectRef,
    data: { approvalId: created.id, policyKey: p.key, amountMinor: input.amountMinor ?? null }
  });

  throw approvalRequired(p.key, created.id);
}

export async function decide(
  ctx: Ctx,
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string
): Promise<ApprovalRow> {
  const rows = await ctx.db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.tenantId, ctx.tenantId), eq(schema.approvals.id, approvalId)))
    .limit(1);
  const row = rows[0] as ApprovalRow | undefined;
  if (!row) throw notFound("approval");
  if (row.decision !== "pending") throw conflict(`already ${row.decision}`);

  const p = APPROVAL_POLICIES[row.policyKey];
  if (!p) throw internal(`unknown approval policy ${row.policyKey}`);

  const subject = { tenantId: ctx.tenantId, module: p.module };
  if (!can(ctx.actor, p.decide, subject)) throw approvalRequired(p.key, row.id);

  const context = row.contextJson ? (JSON.parse(row.contextJson) as { dualControl?: boolean }) : {};
  const decider = actorRef(ctx);
  if (context.dualControl && decider === row.requestedBy) {
    throw badRequest("dual control: the approver must differ from the initiator");
  }
  if (decision === "rejected" && !reason) throw badRequest("a rejection needs a reason");

  const decided: ApprovalRow = {
    ...row,
    decidedBy: decider,
    decision,
    reason: reason ?? null,
    decidedAt: ctx.now
  };
  await ctx.db
    .update(schema.approvals)
    .set({ decidedBy: decider, decision, reason: reason ?? null, decidedAt: ctx.now })
    .where(eq(schema.approvals.id, approvalId));

  await audit(ctx, {
    action: `core.approval.${decision}`,
    subjectRef: row.subjectRef,
    before: row,
    after: decided
  });
  await emit(ctx, {
    module: p.module,
    type: `${p.module}.approval.decided`,
    subject: row.subjectRef,
    data: { approvalId, decision, reason: reason ?? null, policyKey: p.key }
  });

  return decided;
}

export async function pendingApprovals(ctx: Ctx, module?: string, limit = 100): Promise<ApprovalRow[]> {
  const where = module
    ? and(
        eq(schema.approvals.tenantId, ctx.tenantId),
        eq(schema.approvals.decision, "pending"),
        eq(schema.approvals.module, module)
      )
    : and(eq(schema.approvals.tenantId, ctx.tenantId), eq(schema.approvals.decision, "pending"));

  return ctx.db
    .select()
    .from(schema.approvals)
    .where(where)
    .orderBy(desc(schema.approvals.requestedAt))
    .limit(limit) as Promise<ApprovalRow[]>;
}
