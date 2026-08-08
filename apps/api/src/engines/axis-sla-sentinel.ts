import { desc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@lyra/db";
import { scoped, type Ctx } from "@lyra/core";
import { parseSla, slaMessages, type Gateway, type SlaBreachDriver } from "@lyra/model-gateway";

// docs/specs/gap-axis-design.md §G.4. SLA Sentinel: estimate breach risk from
// a case's age, status, process-event history, queue depth and owner load.
//
// Ambient, not consequential (CLAUDE.md §4): generation only, never writes
// anything — no axis_sla_* table exists, and the spec's human boundary
// ("reprioritizes a queue and drafts a chase") names actions with no
// infrastructure yet (queue order is the future Prioritiser, chase drafting
// needs an outbox the Chaser will own — both §G.6, ADR-0035 pending). This
// engine only produces the estimate those agents will eventually consume.

type CaseRow = typeof schema.axisCases.$inferSelect;

const HISTORY_LIMIT = 10;

/** Most recent process events for this case, newest first. */
export async function caseHistory(ctx: Ctx, case_: CaseRow): Promise<(typeof schema.axisProcessEvents.$inferSelect)[]> {
  return ctx.db
    .select()
    .from(schema.axisProcessEvents)
    .where(scoped(ctx, schema.axisProcessEvents, eq(schema.axisProcessEvents.caseId, case_.id)))
    .orderBy(desc(schema.axisProcessEvents.ts))
    .limit(HISTORY_LIMIT);
}

/** Open cases (`closed_at IS NULL`) sharing this case's status — how backed up that queue is. */
export async function queueDepth(ctx: Ctx, case_: CaseRow): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.axisCases)
    .where(scoped(ctx, schema.axisCases, eq(schema.axisCases.status, case_.status), isNull(schema.axisCases.closedAt)));
  return row?.n ?? 0;
}

/** Open cases already owned by this case's owner. Null owner means unassigned, no load to count. */
export async function ownerLoad(ctx: Ctx, case_: CaseRow): Promise<number> {
  if (!case_.ownerRef) return 0;
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(schema.axisCases)
    .where(scoped(ctx, schema.axisCases, eq(schema.axisCases.ownerRef, case_.ownerRef), isNull(schema.axisCases.closedAt)));
  return row?.n ?? 0;
}

export interface SlaBreachPrediction {
  breachProbability: number;
  /** Deterministic from `slaDueAt`, not model-generated — the exact figure is already on the row. Null when the case has no SLA due date, or negative clamped to 0 once overdue. */
  hoursToBreach: number | null;
  driver: SlaBreachDriver | null;
  aiAuditId: string;
}

/** Generation only — never writes anything. Ambient, not consequential (CLAUDE.md §4): a failed call predicts nothing. */
export async function predictSlaBreach(ctx: Ctx, case_: CaseRow, gateway: Gateway): Promise<SlaBreachPrediction | null> {
  try {
    const [history, depth, load] = await Promise.all([caseHistory(ctx, case_), queueDepth(ctx, case_), ownerLoad(ctx, case_)]);
    const hoursUntilDue = case_.slaDueAt === null ? null : (case_.slaDueAt - ctx.now) / 3_600_000;

    const reply = await gateway.complete(ctx, {
      module: "axis",
      purpose: "axis.case.sla_predict",
      tier: "fast",
      messages: slaMessages({
        kind: case_.kind,
        status: case_.status,
        priority: case_.priority,
        ageMs: ctx.now - case_.createdAt,
        hoursUntilDue,
        history: history.map((h) => ({ step: h.step, outcome: h.outcome, durationMs: h.durationMs, ts: h.ts })),
        queueDepth: depth,
        ownerLoad: load
      })
    });

    const estimate = parseSla(reply.text);
    return {
      breachProbability: estimate.breachProbability,
      hoursToBreach: hoursUntilDue === null ? null : Math.max(0, hoursUntilDue),
      driver: estimate.driver,
      aiAuditId: reply.auditId
    };
  } catch {
    return null;
  }
}
