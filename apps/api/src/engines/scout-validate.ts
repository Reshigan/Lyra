import { and, eq } from "drizzle-orm";
import { schema } from "@lyra/db";
import { audit, emit, type Ctx } from "@lyra/core";

// The validation half of the SCOUT loop (docs/modules/scout.md §2.2/§2.5).
// The promote half existed — a whitespace goes `validating` and a SIGNAL
// campaign is drafted from its brief (scout-promote.ts) — but nothing ever
// came back: an experiment could conclude and the whitespace stayed
// `validating` forever, so the radar could not say which gaps live data had
// actually confirmed. This engine is the return path.
//
//   whitespace (candidate → validating → promote) → experiment runs →
//   experiment concludes → THIS stamps validated/parked + emits
//   scout.whitespace.validated → the radar shows the proof.
//
// The verdict comes from the experiment's own resultsJson, never from a
// human re-judging: the sequential-test math already decided (docs/modules/
// scout.md §2.5 "nothing wins by eyeball"), and this engine only carries
// that decision to the row it belongs to.

export interface ExperimentResults {
  /** The pre-declared metric's observed lift in basis points; negative = underperformed. */
  liftBps?: number;
  /** Whether the sequential test crossed its significance threshold. */
  significant?: boolean;
  /** Free-form detail from the analyst — carried through to the audit row. */
  summary?: string;
}

/** A concluded experiment's verdict for its whitespace. */
export type Verdict = "validated" | "parked";

/**
 * Decide a whitespace's fate from experiment results. Pure: the same results
 * always give the same verdict, which is what makes the loop auditable.
 *
 * Validated requires BOTH a significant result AND non-negative lift — a
 * statistically confident failure validates nothing. Anything else parks the
 * whitespace: "not pursuing this" is SCOUT's terminal state, and an
 * inconclusive experiment is exactly that decision made with evidence.
 */
export function verdictOf(results: ExperimentResults | null): Verdict {
  if (!results) return "parked";
  const significant = results.significant === true;
  const lift = typeof results.liftBps === "number" ? results.liftBps : null;
  return significant && lift !== null && lift >= 0 ? "validated" : "parked";
}

interface ExperimentRow {
  id: string;
  whitespaceId: string;
  state: string;
  resultsJson: string | null;
}

/**
 * Called when a scout experiment lands on `concluded` (from the CRUD
 * afterWrite hook). Stamps the parent whitespace with the verdict, emits
 * `scout.whitespace.validated` (the event NORTH and the radar read), and
 * audits the whole chain: experiment → results → verdict → whitespace.
 *
 * Idempotent by construction: re-concluding the same experiment re-stamps
 * the same verdict, and a whitespace already terminal (`validated`/`parked`)
 * is left alone — a second experiment does not reopen a decided gap.
 */
export async function onExperimentConcluded(ctx: Ctx, experiment: ExperimentRow): Promise<boolean> {
  if (experiment.state !== "concluded") return false;

  let results: ExperimentResults | null = null;
  if (experiment.resultsJson) {
    try {
      results = JSON.parse(experiment.resultsJson) as ExperimentResults;
    } catch {
      results = null; // malformed results park the gap — fail closed
    }
  }
  const verdict = verdictOf(results);

  const [whitespace] = await ctx.db
    .select()
    .from(schema.scoutWhitespaces)
    .where(and(eq(schema.scoutWhitespaces.tenantId, ctx.tenantId), eq(schema.scoutWhitespaces.id, experiment.whitespaceId)))
    .limit(1);
  if (!whitespace) return false;

  // Terminal stays terminal: a gap the business already parked or validated
  // is not reopened because another experiment later concluded against it.
  if (whitespace.status === "validated" || whitespace.status === "parked") return false;

  await ctx.db
    .update(schema.scoutWhitespaces)
    .set({ status: verdict, updatedAt: ctx.now })
    .where(eq(schema.scoutWhitespaces.id, whitespace.id));

  await emit(ctx, {
    module: "scout",
    type: "scout.whitespace.validated",
    subject: whitespace.id,
    data: {
      whitespaceId: whitespace.id,
      experimentId: experiment.id,
      verdict,
      liftBps: results?.liftBps ?? null,
      significant: results?.significant ?? false
    }
  });
  await audit(ctx, {
    action: "scout.whitespace.verdict",
    subjectRef: `whitespaces:${whitespace.id}`,
    before: { status: whitespace.status },
    after: {
      status: verdict,
      experimentId: experiment.id,
      results: results ?? null
    }
  });
  return true;
}
