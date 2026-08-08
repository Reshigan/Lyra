import { z } from "zod";
import { schema } from "@lyra/db";
import {
  assertCaseTransition,
  audit,
  conflict,
  emit,
  gate,
  isCaseState,
  scoped,
  type Ctx
} from "@lyra/core";
import { eq } from "drizzle-orm";

// docs/specs/gap-axis-design.md §D.9. Mirrors axis-claim-lifecycle.ts's
// transitions section: a case has no ledger money of its own (no
// lastTxnId column, no runTxn), so the only thing this module owes a
// transition is the state machine and, for `issued`, the axis.case_issue
// approval gate.

type CaseRow = typeof schema.axisCases.$inferSelect;

const PERM_FOR: Record<string, string> = {
  issued: "axis:cases:approve"
};

export function permissionForCaseTransition(to: string): string {
  return PERM_FOR[to] ?? "axis:cases:update";
}

export const CaseTransitionBody = z.object({
  to: z.string().min(1).max(32),
  reasonCode: z.string().max(64).nullish(),
  reason: z.string().max(2000).nullish()
});
export type CaseTransitionInput = z.infer<typeof CaseTransitionBody>;

const EVENT_FOR: Record<string, string> = {
  quoting: "axis.case.quoting",
  awaiting_docs: "axis.case.awaiting_docs",
  review: "axis.case.review",
  approval: "axis.case.approval",
  issued: "axis.case.issued",
  failed: "axis.case.failed",
  cancelled: "axis.case.cancelled",
  intake: "axis.case.reopened"
};

export async function transitionCase(ctx: Ctx, kase: CaseRow, input: CaseTransitionInput) {
  if (!isCaseState(input.to)) throw conflict(`${input.to} is not a case state`);
  assertCaseTransition(kase.status as never, input.to);

  const decision = input.to === "issued";
  const subjectRef = `axis_case_issue:${kase.id}`;
  const approval = decision
    ? await gate(ctx, {
        policyKey: "axis.case_issue",
        subjectRef,
        amountMinor: kase.valueMinor ?? 0,
        context: { caseId: kase.id, from: kase.status, to: input.to, reasonCode: input.reasonCode ?? null }
      })
    : null;

  const after: CaseRow = {
    ...kase,
    status: input.to,
    ...(input.to === "issued" || input.to === "cancelled" ? { closedAt: ctx.now } : {}),
    updatedAt: ctx.now
  };
  await ctx.db
    .update(schema.axisCases)
    .set({ status: after.status, closedAt: after.closedAt, updatedAt: ctx.now })
    .where(scoped(ctx, schema.axisCases, eq(schema.axisCases.id, kase.id)));

  await audit(ctx, { action: `axis.case.${input.to}`, subjectRef: kase.id, before: kase, after });
  await emit(ctx, {
    module: "axis",
    type: EVENT_FOR[input.to] ?? "axis.case.state_changed",
    subject: kase.id,
    data: {
      caseId: kase.id,
      customerId: kase.customerId,
      from: kase.status,
      to: input.to,
      reasonCode: input.reasonCode ?? null,
      approvalId: approval?.id ?? null
    }
  });
  return { case: after };
}
