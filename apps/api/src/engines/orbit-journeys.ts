import { and, eq } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import { audit, badRequest, conflict, currentConsent, emit, type Ctx } from "@lyra/core";
import { must } from "../rows.js";

// docs/05 §Journeys — "consent & quiet-hours & frequency caps baked in as
// unremovable floors", across every journey kind (welcome, doc-chase, renewal,
// win-back, NPS, dunning), not just marketing sends. This is the writer that
// was missing entirely: `orbitJourneys`/`orbitJourneyRuns` had CRUD and
// nothing that ever walked a graph.

interface JourneyNode {
  key: string;
  type: string;
  [k: string]: unknown;
}

interface JourneyEdge {
  from: string;
  to: string;
}

interface JourneyGraph {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  /**
   * Not a schema column: `orbit_journeys.graph_json` is freeform (docs/16
   * seam), so the cooldown floor lives inside it rather than forcing a
   * migration for one integer. Absent/0 = no cap.
   */
  cooldownDays?: number;
}

const DAY_MS = 86_400_000;

function parseGraph(raw: string): JourneyGraph {
  const g = JSON.parse(raw) as JourneyGraph;
  return {
    nodes: g.nodes ?? [],
    edges: g.edges ?? [],
    ...(g.cooldownDays === undefined ? {} : { cooldownDays: g.cooldownDays })
  };
}

/** The node a fresh run starts on: whatever the `trigger` node points to, or the first node if the graph has no edges. */
function startNode(graph: JourneyGraph): string {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  if (trigger) {
    const edge = graph.edges.find((e) => e.from === trigger.key);
    if (edge) return edge.to;
  }
  return graph.nodes[0]?.key ?? "start";
}

export interface TriggerJourneyResult {
  /** Customers a run was created or restarted for. */
  triggered: string[];
  /** Customers skipped: consent for marketing was explicitly withdrawn. */
  skippedConsent: string[];
  /** Customers skipped: an existing run is still inside the journey's cooldown window. */
  skippedCooldown: string[];
}

/**
 * Consent floor: reuses `currentConsent` from packages/core (not SIGNAL's
 * suppression-audience, which is a marketing-campaign construct and would be
 * a cross-module import outside `packages/core` — CLAUDE.md rule 6). A
 * customer with no consent row yet is not "withdrawn" — only an explicit
 * `purposes.marketing === false` is, matching the same convention
 * `signal-suppression.ts#onConsentUpdated` already uses for the same signal.
 */
async function consentWithdrawn(ctx: Ctx, customerId: string): Promise<boolean> {
  const state = await currentConsent(ctx, customerId);
  return state?.purposes.marketing === false;
}

/**
 * Given a journey and a cohort of customer ids, create (or, once the cooldown
 * has elapsed, restart) one `orbit_journey_runs` row per eligible customer.
 * The unique `(tenantId, journeyId, customerId)` index means there is
 * structurally never more than one row per pair; the cooldown decides whether
 * a second trigger inside the window is a no-op or a restart.
 */
export async function triggerJourney(
  ctx: Ctx,
  journeyId: string,
  customerIds: readonly string[]
): Promise<TriggerJourneyResult> {
  const journey = await must(ctx, schema.orbitJourneys, journeyId, "journey");
  if (journey.status !== "active") throw conflict(`journey is ${journey.status}, not active`);

  const graph = parseGraph(journey.graphJson);
  const node = startNode(graph);
  // ORB-051: frequency caps are an "unremovable floor", not an opt-in — an
  // active journey with no cooldownDays would silently mean "no cap" instead
  // of forcing the author to set one. The actual number stays theirs to pick;
  // what's non-negotiable is that there has to be one.
  if (!graph.cooldownDays || graph.cooldownDays <= 0) {
    throw badRequest("journey graph.cooldownDays must be a positive number of days — frequency caps are an unremovable floor (docs/17 ORB-051)");
  }
  const cooldownMs = graph.cooldownDays * DAY_MS;

  const triggered: string[] = [];
  const skippedConsent: string[] = [];
  const skippedCooldown: string[] = [];

  for (const customerId of customerIds) {
    if (await consentWithdrawn(ctx, customerId)) {
      skippedConsent.push(customerId);
      continue;
    }

    const [existing] = await ctx.db
      .select()
      .from(schema.orbitJourneyRuns)
      .where(
        and(
          eq(schema.orbitJourneyRuns.tenantId, ctx.tenantId),
          eq(schema.orbitJourneyRuns.journeyId, journeyId),
          eq(schema.orbitJourneyRuns.customerId, customerId)
        )
      );

    if (existing) {
      if (cooldownMs > 0 && ctx.now - existing.updatedAt < cooldownMs) {
        skippedCooldown.push(customerId);
        continue;
      }
      await ctx.db
        .update(schema.orbitJourneyRuns)
        .set({ node, state: "running", contextJson: null, nextAt: null, updatedAt: ctx.now })
        .where(eq(schema.orbitJourneyRuns.id, existing.id));
    } else {
      await ctx.db.insert(schema.orbitJourneyRuns).values({
        id: newId("jrun", ctx.now),
        tenantId: ctx.tenantId,
        journeyId,
        customerId,
        node,
        state: "running",
        contextJson: null,
        nextAt: null,
        createdAt: ctx.now,
        updatedAt: ctx.now
      });
    }
    triggered.push(customerId);
  }

  if (triggered.length) {
    await audit(ctx, {
      action: "orbit.journey.triggered",
      subjectRef: journeyId,
      after: { triggered: triggered.length, skippedConsent: skippedConsent.length, skippedCooldown: skippedCooldown.length }
    });
    await emit(ctx, {
      module: "orbit",
      type: "orbit.journey.triggered",
      subject: journeyId,
      data: { journeyId, customerIds: triggered }
    });
  }

  return { triggered, skippedConsent, skippedCooldown };
}
