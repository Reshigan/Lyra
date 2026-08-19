import { and, eq, isNull } from "drizzle-orm";
import { id as newId, schema } from "@lyra/db";
import {
  actorRef,
  audit,
  conflict,
  countAttributes,
  DEFAULT_K_FLOOR,
  emit,
  targetablePool,
  type AttributeCount,
  type Ctx
} from "@lyra/core";
import {
  audienceEvidenceLines,
  audienceProposalMessages,
  audienceProposalSchema,
  fallbackTargetingProposal,
  parseAudienceProposal,
  promptNouns,
  type AudienceEvidence,
  type Gateway,
  type TargetingProposal
} from "@lyra/model-gateway";

// docs/17-user-spec-benchmark.md §SIG-025 ("audience estimate") and the
// boundary docs/specs/gap-signal-design.md §H.2 draws around it: the model
// "never queries customer rows — it is given aggregate counts per attribute,
// above the k-anonymity floor, and proposes a rule over attribute names".
//
// This engine is the half of that sentence the model cannot be trusted with.
// It counts the book itself, suppresses every thin cell, hands the model only
// what survived, and writes the rule the *validated* proposal builds — so the
// worst a bad reply can do is name a cell that was already on the page.

export interface SuggestedAudience {
  audienceId: string;
  proposal: TargetingProposal;
  /** Whether the pool came from the model or the deterministic fallback. */
  source: "ai" | "fallback";
  /** The gateway audit row; null when the call itself failed. */
  auditId: string | null;
  /** Exactly the counts the model was shown — the UI's "what it saw" panel. */
  shownCounts: AttributeCount[];
}

/** What a pool is being proposed *for*: a promoted whitespace, or a scenario a
 *  marketer typed. Momentum and signal count only exist for the first. */
export interface TargetingSubject {
  subject: string;
  momentum: number | null;
  signalCount: number | null;
}

/**
 * The targetable, k-suppressed attribute counts for a tenant's book.
 *
 * ponytail: one scan of `core_customers.tagsJson` and the counting in JS, not
 * SQL — SQLite has no array type, so a GROUP BY would need a join table that
 * does not exist yet. Upgrade path is a real `customer_attributes` table the
 * day this scan shows up in a profile; `countAttributes` is already the seam.
 */
export async function attributeCounts(
  ctx: Ctx,
  floor: number = DEFAULT_K_FLOOR
): Promise<{ counts: AttributeCount[]; bookSize: number }> {
  const rows = await ctx.db
    .select({ tagsJson: schema.customers.tagsJson })
    .from(schema.customers)
    // Soft-deleted customers are erased people. Counting them inflates the
    // book, can lift a thin cell over the k-anonymity floor on deleted rows
    // alone, and inflates the reach a human funds a campaign against.
    .where(and(eq(schema.customers.tenantId, ctx.tenantId), isNull(schema.customers.deletedAt)));

  // Which axes count at all is the tenant's domain pack's answer (ADR-0069):
  // a Gulf book is cut on income quintiles, a ZA one on LSM.
  const pack = ctx.policy.domainPack;
  const tagSets = rows.map((r) => tagsOf(r.tagsJson));
  return { counts: targetablePool(countAttributes(tagSets, pack), floor, pack), bookSize: rows.length };
}

/**
 * Propose a targeting pool, and park it as a draft audience.
 *
 * The audience is written whichever way the proposal arrived — a fallback pool
 * is still a pool a human can edit, and docs/15 §4 is explicit that a model
 * failure degrades the draft rather than the feature. Nothing is sent: an
 * audience row is a definition, and the campaign that uses it still goes
 * through its own approval.
 */
export async function suggestTargeting(
  ctx: Ctx,
  gateway: Gateway,
  subject: TargetingSubject,
  opts: { floor?: number } = {}
): Promise<SuggestedAudience> {
  const floor = opts.floor ?? DEFAULT_K_FLOOR;
  const { counts, bookSize } = await attributeCounts(ctx, floor);
  if (counts.length === 0) {
    // Not an empty pool — no book to target at all. Writing an audience that
    // reaches nobody would read as a bad model reply rather than as a tenant
    // that has never tagged a customer.
    throw conflict(`no customer attributes survive a k-anonymity floor of ${floor}`);
  }

  const ev: AudienceEvidence = { ...subject, bookSize, counts, floor, pack: ctx.policy.domainPack };
  const drafted = await proposePool(ctx, gateway, ev);

  const audienceId = newId("aud", ctx.now);
  await ctx.db.insert(schema.signalAudiences).values({
    id: audienceId,
    tenantId: ctx.tenantId,
    name: drafted.proposal.name,
    definitionJson: JSON.stringify({
      ...drafted.proposal.rule,
      // Everything a human needs to approve the spend, alongside the rule the
      // resolver runs. The reasons are the point: a pool is a decision about
      // who a tenant pays to reach, and an unexplained band is one nobody can
      // sign off on.
      targeting: {
        subject: ev.subject,
        summary: drafted.proposal.summary,
        lsm: drafted.proposal.lsm,
        demographics: drafted.proposal.demographics,
        reasons: drafted.proposal.reasons,
        estimatedReach: drafted.proposal.estimatedReach,
        confidence: drafted.proposal.confidence,
        source: drafted.source,
        floor,
        shownCounts: counts,
        evidence: audienceEvidenceLines(ev, promptNouns(ctx.policy.domainPack))
      }
    }),
    sizeCached: drafted.proposal.estimatedReach,
    refreshPolicy: "manual",
    lastRefreshedAt: ctx.now,
    consentPurposes: "marketing",
    createdBy: actorRef(ctx),
    createdAt: ctx.now,
    updatedAt: ctx.now
  });

  await audit(ctx, {
    action: "signal.audience.suggested",
    subjectRef: `signal_audience:${audienceId}`,
    after: {
      subject: ev.subject,
      demographics: drafted.proposal.demographics.map((d) => `${d.axis}=${d.value}`),
      lsm: drafted.proposal.lsm,
      estimatedReach: drafted.proposal.estimatedReach,
      confidence: drafted.proposal.confidence,
      source: drafted.source,
      floor
    }
  });

  await emit(ctx, {
    module: "signal",
    type: "signal.audience.suggested",
    subject: audienceId,
    data: {
      subject: ev.subject,
      estimatedReach: drafted.proposal.estimatedReach,
      confidence: drafted.proposal.confidence,
      source: drafted.source
    }
  });

  return { audienceId, proposal: drafted.proposal, source: drafted.source, auditId: drafted.auditId, shownCounts: counts };
}

/**
 * The pool, through the gateway (CLAUDE.md rule 3 — module/purpose/tier/actor,
 * one ai_audit_log row) and through the strict parser. Mirrors `draftBrief` in
 * scout-promote.ts, for the same reason: an unparseable, ungrounded or
 * wholly-rejected reply falls back to the deterministic pool at confidence 0
 * rather than 500ing at a marketer.
 */
async function proposePool(
  ctx: Ctx,
  gateway: Gateway,
  ev: AudienceEvidence
): Promise<{ proposal: TargetingProposal; source: "ai" | "fallback"; auditId: string | null }> {
  const nouns = promptNouns(ctx.policy.domainPack);
  try {
    const res = await gateway.complete(ctx, {
      module: "signal",
      purpose: "audience.suggest",
      tier: "reasoning",
      subjectRef: ev.subject,
      responseSchema: audienceProposalSchema(),
      messages: audienceProposalMessages(ev, nouns)
    });
    const proposal = parseAudienceProposal(res.text, ev, nouns);
    return proposal
      ? { proposal, source: "ai", auditId: res.auditId }
      : { proposal: fallbackTargetingProposal(ev, nouns), source: "fallback", auditId: res.auditId };
  } catch {
    return { proposal: fallbackTargetingProposal(ev, nouns), source: "fallback", auditId: null };
  }
}

/** `tagsJson` is nullable and free-form (a tenant writes it, not a migration),
 *  so anything that is not an array of strings counts as no tags rather than
 *  taking the whole scan down. */
function tagsOf(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
