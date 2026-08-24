import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, can, type Ctx } from "@lyra/core";

// AXIS-007: bulk actions (assign, reprioritise, close, tag) with permission
// checks and audit. The design decision is per-row honesty again — a bulk
// operation over fifty cases where three fail permission or state must not
// be all-or-nothing (an operator fixing a queue does not want a rollback
// because one case was closed by someone else mid-selection), and must not
// be silent either. Every row gets an outcome; the response names the
// failures; the audit log records the whole batch once with its counts.

export type BulkAction = "assign" | "reprioritise" | "close" | "tag";

/** The permission each action needs — checked per row against that row's
 *  tenant, so a cross-tenant id in the payload can never ride a bulk grant. */
const ACTION_PERMISSION: Record<BulkAction, string> = {
  assign: "axis:cases:assign",
  reprioritise: "axis:cases:update",
  close: "axis:cases:update",
  tag: "axis:cases:update"
};

export interface BulkOp {
  action: BulkAction;
  caseIds: string[];
  /** assign: `user:<id>` | `agent:<key>`. */
  ownerRef?: string | undefined;
  /** reprioritise: low|normal|high|urgent. */
  priority?: string | undefined;
  /** tag: stored into metaJson.tags. */
  tag?: string | undefined;
}

export interface BulkRowOutcome {
  caseId: string;
  ok: boolean;
  error?: string;
}

export interface BulkResult {
  applied: number;
  failed: number;
  outcomes: BulkRowOutcome[];
}

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/**
 * Apply one bulk operation. Never throws for per-row reasons — those come
 * back as failed outcomes. Throws only for a malformed operation itself
 * (unknown action, missing parameter), which is a caller bug, not data.
 */
export async function applyBulkAction(ctx: Ctx, op: BulkOp): Promise<BulkResult> {
  const permission = ACTION_PERMISSION[op.action];
  if (!permission) throw new Error(`unknown bulk action ${op.action}`);
  if (!op.caseIds.length) throw new Error("caseIds must not be empty");

  if (op.action === "assign" && !op.ownerRef) throw new Error("assign requires ownerRef");
  if (op.action === "reprioritise") {
    if (!op.priority || !PRIORITIES.includes(op.priority as (typeof PRIORITIES)[number])) {
      throw new Error(`reprioritise requires priority one of ${PRIORITIES.join("|")}`);
    }
  }
  if (op.action === "tag" && !op.tag?.trim()) throw new Error("tag requires tag");

  // One scoped fetch: only this tenant's open cases, whatever subset of the
  // payload they are. A case id from another tenant (or already closed) is a
  // failed outcome, not a silent skip — the operator selected it and deserves
  // to know it did not happen.
  const rows = await ctx.db
    .select()
    .from(schema.axisCases)
    .where(
      and(
        eq(schema.axisCases.tenantId, ctx.tenantId),
        inArray(schema.axisCases.id, op.caseIds),
        isNull(schema.axisCases.deletedAt)
      )
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const outcomes: BulkRowOutcome[] = [];
  let applied = 0;

  for (const caseId of op.caseIds) {
    const row = byId.get(caseId);
    if (!row) {
      outcomes.push({ caseId, ok: false, error: "not found in this tenant" });
      continue;
    }
    if (!can(ctx.actor, permission, { tenantId: ctx.tenantId })) {
      outcomes.push({ caseId, ok: false, error: `missing ${permission}` });
      continue;
    }
    if (op.action === "close" && row.closedAt) {
      outcomes.push({ caseId, ok: false, error: "already closed" });
      continue;
    }

    const before = row;
    const after: Record<string, unknown> = { ...row, updatedAt: ctx.now };
    if (op.action === "assign") after.ownerRef = op.ownerRef;
    if (op.action === "reprioritise") after.priority = op.priority;
    if (op.action === "close") {
      after.status = "cancelled";
      after.closedAt = ctx.now;
    }
    if (op.action === "tag") {
      let tags: string[] = [];
      try {
        const meta = row.metaJson ? (JSON.parse(row.metaJson) as { tags?: unknown }) : {};
        if (Array.isArray(meta.tags)) tags = meta.tags.filter((t): t is string => typeof t === "string");
      } catch {
        tags = [];
      }
      if (!tags.includes(op.tag!)) tags.push(op.tag!);
      let meta: Record<string, unknown> = {};
      try {
        meta = row.metaJson ? (JSON.parse(row.metaJson) as Record<string, unknown>) : {};
      } catch {
        meta = {};
      }
      after.metaJson = JSON.stringify({ ...meta, tags });
    }

    await ctx.db
      .update(schema.axisCases)
      .set({
        ...(op.action === "assign" ? { ownerRef: op.ownerRef } : {}),
        ...(op.action === "reprioritise" ? { priority: op.priority! } : {}),
        ...(op.action === "close" ? { status: "cancelled", closedAt: ctx.now } : {}),
        ...(op.action === "tag" ? { metaJson: after.metaJson as string } : {}),
        updatedAt: ctx.now
      })
      .where(and(eq(schema.axisCases.tenantId, ctx.tenantId), eq(schema.axisCases.id, caseId)));

    // Per-row audit: a bulk grant touched N cases and the log says which.
    await audit(ctx, {
      action: `axis.cases.bulk_${op.action}`,
      subjectRef: `cases:${caseId}`,
      before,
      after
    });
    outcomes.push({ caseId, ok: true });
    applied++;
  }

  await audit(ctx, {
    action: `axis.cases.bulk_${op.action}_batch`,
    subjectRef: `cases:bulk:${ctx.now}`,
    after: { action: op.action, requested: op.caseIds.length, applied, failed: outcomes.length - applied }
  });

  return { applied, failed: outcomes.length - applied, outcomes };
}
