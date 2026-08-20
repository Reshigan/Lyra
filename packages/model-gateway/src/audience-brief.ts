import {
  affluenceBandOf,
  estimateReach,
  isTargetable,
  verifyGroundedness,
  type Attribute,
  type AttributeCount
} from "@lyra/core";
import { parseJsonObject } from "./parse.js";
import type { PromptNouns } from "./vocabulary.js";

// docs/17-user-spec-benchmark.md §SIG-025 ("audience estimate") and
// docs/specs/gap-signal-design.md §H.2, which sets the boundary this module is
// built to: the model "never queries customer rows — it is given aggregate
// counts per attribute, above the k-anonymity floor, and proposes a rule over
// attribute names". packages/core/src/targeting.ts is the counting half; this is
// the proposing half.
//
// The model does NOT emit the rule tree. It returns a list of {axis, value,
// reason} selections; this file validates each one against the counts it was
// actually shown and then *builds* the tree deterministically. That inversion is
// the whole design: a model that emits a rule can emit a rule over an axis it
// invented, over a value nobody has, or over `race` — and the tree would look
// well-formed. A model that emits selections can only ever name cells that were
// on the page in front of it, and everything else is dropped before a tree
// exists.
//
// The `reason` is not decoration. A targeting pool is a decision about who a
// tenant spends money reaching and who it passes over, and a human approving
// that spend is entitled to see why each band is in it. A selection with no
// reason is dropped exactly like a selection with a bad axis.

/** One targeted cell plus the sentence that justifies it. */
export interface DemographicReason extends Attribute {
  /** Why this band is in the pool, in the model's own words, grounded in the
   *  counts it was shown. Never empty — an unreasoned selection is dropped. */
  reason: string;
  /** How many customers carry it, restated from the evidence so the UI does not
   *  have to re-join against the counts to show the number beside the reason. */
  count: number;
}

/** A `signal_audiences.definitionJson` leaf — the grammar packages/core/src/seed/signal.ts seeds. */
export interface RuleLeaf {
  field: string;
  op: string;
  value: unknown;
}

export interface AudienceRule {
  all: RuleLeaf[];
}

export interface TargetingProposal {
  /** Audience name, <= 80 chars. */
  name: string;
  /** One paragraph on who this pool is, <= 300 chars. */
  summary: string;
  /** The accepted cells, in the order the model proposed them. */
  demographics: Attribute[];
  /** The same cells with their justifications — the user-visible "why these". */
  reasons: DemographicReason[];
  /** Bands on the pack's affluence scale among the accepted cells, ascending.
   *  Empty for a pack that bands on nothing; a convenience for the media-plan
   *  UI, not a second source of truth.
   *
   *  ponytail: still spelled `lsm`, and it is no longer only LSM. The name is a
   *  wire field — `signal_audiences.definitionJson.targeting.lsm`, read back by
   *  apps/api's planAudience and apps/web's signal.shared.ts — so renaming it
   *  silently blanks the band line for every audience already stored. Upgrade
   *  path when it is worth a migration: write both `lsm` and `bands`, read
   *  `bands ?? lsm`, drop `lsm` a release later (ADR-0069). */
  lsm: number[];
  /** The resolver-ready tree, built here rather than by the model. */
  rule: AudienceRule;
  /** Ceiling on the pool, from marginal counts (packages/core estimateReach). */
  estimatedReach: number;
  /** Share of the model's proposals that survived validation, 0-100. Below 100
   *  means it named something protected, unseen or unreasoned. */
  confidence: number;
}

/**
 * Everything the model is allowed to know — and therefore, via
 * `verifyGroundedness`, every number it is allowed to state.
 *
 * `counts` must already be through `targetablePool`: protected axes stripped and
 * thin cells suppressed. This module re-checks the axis on the way out (a caller
 * that forgot is a bug, not a leak) but it cannot re-suppress what it was handed,
 * so the floor is applied before the evidence is built, not after.
 */
export interface AudienceEvidence {
  /** What the campaign is about — a whitespace category, or a free-text scenario. */
  subject: string;
  /** 0-100 demand momentum, null when the source is a scenario rather than a
   *  SCOUT candidate (a scenario has no measured demand behind it yet). */
  momentum: number | null;
  /** Demand signals behind the subject; null for the same reason. */
  signalCount: number | null;
  /** Customers on the tenant's book. */
  bookSize: number;
  /** Suppressed, targetable attribute counts. */
  counts: readonly AttributeCount[];
  /** The k-anonymity floor those counts were suppressed at. */
  floor: number;
  /** The tenant's domain pack, which decides which axes are targetable at all
   *  and what the affluence bands mean. Omitted reads as the default pack, so
   *  an existing ZA caller keeps exactly the prompt it had. */
  pack?: string;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function audienceProposalSchema(): Record<string, unknown> {
  return {
    name: "signal_targeting_proposal",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        summary: { type: "string" },
        selections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              axis: { type: "string" },
              value: { type: "string" },
              reason: { type: "string" }
            },
            required: ["axis", "value", "reason"]
          }
        }
      },
      required: ["name", "summary", "selections"]
    }
  };
}

/**
 * The evidence, one fact per line — the exact lines `verifyGroundedness` scores
 * the reply against, so the prompt and the groundedness pool cannot drift apart.
 *
 * The affluence label rides on the same line as the count so the model is
 * grounded in what a band *means* rather than inventing a lifestyle for a
 * number — LSM 7 for a ZA book, the top income quintile for a Gulf one, off
 * whichever scale the pack declares. Lines for
 * momentum and signal count are omitted entirely when null: a "not measured"
 * line invites the model to reason about the absence, and a scenario has nothing
 * to reason about there.
 */
export function audienceEvidenceLines(ev: AudienceEvidence, nouns: PromptNouns): string[] {
  return [
    `Campaign subject: ${ev.subject}`,
    ...(ev.momentum === null ? [] : [`Demand momentum score (0-100): ${ev.momentum}`]),
    ...(ev.signalCount === null ? [] : [`Demand signals behind this subject: ${ev.signalCount}`]),
    `Customers in the book: ${ev.bookSize}`,
    `Active ${nouns.contracts} are sold to these customers; counts below are per attribute, not per ${nouns.contract}.`,
    `Counts below are suppressed under a k-anonymity floor of ${ev.floor}; nothing thinner is shown.`,
    ...ev.counts.map((c) => {
      const band = affluenceBandOf(c.axis, c.value, ev.pack);
      const head = `Attribute ${c.axis}=${c.value}: ${c.count} customers`;
      return band ? `${head}. ${band.label}` : head;
    })
  ];
}

export function audienceProposalMessages(
  ev: AudienceEvidence,
  nouns: PromptNouns
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        `You choose the audience a ${nouns.domain} campaign should be aimed at. ` +
        "You are given aggregate counts per customer attribute and nothing else — you never see a " +
        "person. Reply with JSON only, matching the schema: name (a short internal audience name), " +
        "summary (one paragraph describing who this pool is), and selections (the attribute cells " +
        "to target). " +
        "Every selection must name an axis and a value exactly as they appear in the counts below; " +
        "do not invent a band, and do not widen a value. Values on the same axis are alternatives " +
        "and add together; different axes narrow each other, so the smallest axis caps the reach. " +
        "Give every selection a reason: one sentence saying why that band belongs in this campaign, " +
        "citing only numbers from the counts below. A selection without a reason is discarded. " +
        "Never select on race, ethnicity, nationality, national origin, residency status, religion, " +
        "belief, health, disability, gender, sex, sexual orientation, politics, union membership, " +
        "biometrics or criminal record — those are not targeting dimensions and naming one discards " +
        "the selection. " +
        "State no number the evidence below did not give you. A human reviews and funds this; you " +
        "only propose it."
    },
    { role: "user", content: audienceEvidenceLines(ev, nouns).join("\n") }
  ];
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * Parses one model reply. Never throws.
 *
 * Returns null when the reply is unusable rather than merely thin:
 *
 *  1. `name` or `summary` is missing, or `selections` is not a non-empty array.
 *     An audience with no members is not a smaller audience, it is not one.
 *  2. The name or summary states a number the evidence did not contain — the
 *     CLAUDE.md rule 11 inspectability gate, the same `verifyGroundedness` the
 *     whitespace brief is held to.
 *  3. Every selection was rejected. The model was asked to pick from a page of
 *     counts and picked nothing that was on it.
 *
 * An individual selection is *dropped*, not fatal, when its axis is untargetable
 * or protected, its value was never shown, its reason is blank, or its reason
 * cites a number the evidence lacked. Each of those is one bad row among good
 * ones, and the confidence score is what reports it: a proposal at 50 had half
 * its picks thrown away, and a human sees that before funding it.
 *
 * Groundedness is scored per reason rather than over the whole reply so that one
 * hallucinated figure sinks its own selection instead of the entire proposal.
 */
export function parseAudienceProposal(
  reply: string,
  ev: AudienceEvidence,
  nouns: PromptNouns
): TargetingProposal | null {
  const parsed = parseJsonObject(reply) ?? {};

  const name = text(parsed.name, 80);
  const summary = text(parsed.summary, 300);
  const proposed = parsed.selections;
  if (name === null || summary === null || !Array.isArray(proposed) || proposed.length === 0) return null;

  const lines = audienceEvidenceLines(ev, nouns);
  if (!verifyGroundedness([name, summary].join("\n"), lines).ok) return null;

  const reasons: DemographicReason[] = [];
  for (const raw of proposed) {
    if (typeof raw !== "object" || raw === null) continue;
    const sel = raw as Record<string, unknown>;
    const axis = text(sel.axis, 40)?.toLowerCase();
    const value = text(sel.value, 80);
    const reason = text(sel.reason, 300);
    if (!axis || value === null || reason === null) continue;
    if (!isTargetable(axis, ev.pack)) continue;
    // The cell has to be one the model was shown. A value it never saw is either
    // invented or below the floor, and both are refusals for the same reason.
    const shown = ev.counts.find((c) => c.axis === axis && c.value === value);
    if (!shown) continue;
    if (!verifyGroundedness(reason, lines).ok) continue;
    if (reasons.some((r) => r.axis === axis && r.value === value)) continue;
    reasons.push({ axis, value, reason, count: shown.count });
  }
  if (reasons.length === 0) return null;

  const demographics: Attribute[] = reasons.map((r) => ({ axis: r.axis, value: r.value }));
  return {
    name,
    summary,
    demographics,
    reasons,
    lsm: affluenceBandsIn(reasons, ev.pack),
    rule: ruleFor(demographics),
    estimatedReach: estimateReach(demographics, ev.counts),
    confidence: Math.round((reasons.length / proposed.length) * 100)
  };
}

/** The affluence bands among a set of selections, ascending. Another axis and
 *  an unrecognised band both contribute nothing rather than a hole in the list. */
function affluenceBandsIn(reasons: readonly DemographicReason[], pack?: string): number[] {
  return reasons
    .flatMap((r) => affluenceBandOf(r.axis, r.value, pack) ?? [])
    .map((b) => b.band)
    .sort((a, b) => a - b);
}

/**
 * The resolver-ready tree, one leaf per axis.
 *
 * Values within an axis are alternatives (`in`), axes intersect (`all`) — the
 * same arithmetic `estimateReach` does, so the number shown to the approver and
 * the rule that runs later cannot disagree about what was meant.
 *
 * The marketing-consent leaf is not optional and is not the model's to propose:
 * docs/12 and every seeded audience in packages/core/src/seed/signal.ts carry it,
 * and an audience built without it would be a lawful-basis hole that no amount of
 * good targeting redeems.
 */
function ruleFor(demographics: readonly Attribute[]): AudienceRule {
  const byAxis = new Map<string, string[]>();
  for (const d of demographics) byAxis.set(d.axis, [...(byAxis.get(d.axis) ?? []), d.value]);
  return {
    all: [
      ...[...byAxis].map(([axis, values]) => ({ field: `customer.attr.${axis}`, op: "in", value: values })),
      { field: "consent.marketing", op: "eq", value: true }
    ]
  };
}

/**
 * The proposal used when the model is unreachable, slow, or ungrounded.
 *
 * Deterministic and evidence-only: the largest cell on each of the two largest
 * axes, with the count as its own reason. It is a dull audience and it is meant
 * to be — docs/15 §4, AI drafts and does not gate, so a suggestion request never
 * fails outright, and confidence 0 says plainly that no model chose this.
 */
export function fallbackTargetingProposal(ev: AudienceEvidence, nouns: PromptNouns): TargetingProposal {
  const picked: AttributeCount[] = [];
  const axes = new Set<string>();
  for (const c of ev.counts) {
    if (axes.has(c.axis) || !isTargetable(c.axis, ev.pack)) continue;
    axes.add(c.axis);
    picked.push(c);
    if (picked.length === 2) break;
  }

  const reasons: DemographicReason[] = picked.map((c) => ({
    axis: c.axis,
    value: c.value,
    reason: `${c.count} customers carry ${c.axis}=${c.value}, the largest cell on this attribute.`,
    count: c.count
  }));
  const demographics: Attribute[] = reasons.map((r) => ({ axis: r.axis, value: r.value }));

  return {
    name: `${ev.subject} — largest reachable segments`,
    summary:
      `The biggest attribute cells on a book of ${ev.bookSize} customers, chosen by size alone. ` +
      `No model proposed this pool; narrow it before committing ${nouns.contract} spend.`,
    demographics,
    reasons,
    lsm: affluenceBandsIn(reasons, ev.pack),
    rule: ruleFor(demographics),
    estimatedReach: estimateReach(demographics, ev.counts),
    confidence: 0
  };
}
