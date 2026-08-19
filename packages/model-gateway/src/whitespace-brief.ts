import { verifyGroundedness } from "@lyra/core";
import { parseJsonObject } from "./parse.js";
import type { PromptNouns } from "./vocabulary.js";

// docs/modules/scout.md §8 (whitespace) -> docs/modules/signal.md §2.1 (brief ->
// creative variants). The bridge between them: a SCOUT whitespace candidate is
// evidence about an unserved market, and the thing SIGNAL can act on is a brief.
// This module turns the first into the second.
//
// Same shape as reserve.ts/triage.ts: an exported schema, an exported prompt
// builder, and a parser that is the trust boundary and never throws. What is
// different is the null return: a reserve recommendation of "nothing" is still
// usable, but a *campaign brief* that invents a demand figure is not — the
// caller must fall back to a deterministic brief instead of persisting prose
// nobody can trace. See `parseWhitespaceBrief`.
//
// CLAUDE.md rule 14: no industry noun is hard-coded here. Every one comes from
// `PromptNouns` (vocabulary.ts), read off the tenant's active domain pack, so the
// same prompt briefs an unserved insurance line or an unserved product category.

/** `signal_campaigns.objective` (packages/db/src/schema/signal.ts). */
export const CAMPAIGN_OBJECTIVES = ["acq", "renewal", "xsell"] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

/**
 * Everything the model is allowed to know about the candidate — and therefore,
 * via `verifyGroundedness`, every number it is allowed to state.
 *
 * These are the columns `scout_whitespaces` already holds plus live coverage;
 * nothing here is derived inside the prompt, so the "why" a hover shows and the
 * evidence a brief was built from are the same numbers.
 */
export interface WhitespaceEvidence {
  /** The product line the candidate was flagged on — `core_products.line`. */
  category: string;
  /** 0-100 demand momentum (packages/core/src/whitespace.ts). */
  momentum: number;
  /** Live count of the tenant's own active contracts on this line. */
  coverage: number;
  /** 0-100 panel breadth, null when the panel quoted nothing in the window. */
  competitionScore: number | null;
  /** How many demand signals back the candidate. */
  signalCount: number;
}

export interface WhitespaceBrief {
  /** Campaign name, <= 80 chars. */
  name: string;
  objective: CampaignObjective;
  /** One-line value proposition, <= 200 chars. */
  proposition: string;
  /** The creative brief itself — fed straight to generateCreatives. <= 2000 chars. */
  brief: string;
  /** 0-100 schema-conformance heuristic, same basis as reserve.ts's `confidence`. */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function whitespaceBriefSchema(): Record<string, unknown> {
  return {
    name: "scout_whitespace_brief",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string", enum: [...CAMPAIGN_OBJECTIVES] },
        proposition: { type: "string" },
        brief: { type: "string" }
      },
      required: ["name", "objective", "proposition", "brief"]
    }
  };
}

/**
 * The evidence, one fact per line — the exact lines `verifyGroundedness` scores
 * the reply against, so the prompt and the groundedness pool cannot drift apart.
 * Exported because the commentary path (apps/api/src/engines/scout-whitespace.ts)
 * verifies against the same pool.
 */
export function whitespaceEvidenceLines(ev: WhitespaceEvidence, nouns: PromptNouns): string[] {
  return [
    `Category: ${ev.category}`,
    `Demand momentum score (0-100): ${ev.momentum}`,
    `Active ${nouns.contracts} on the book for this category: ${ev.coverage}`,
    ev.competitionScore === null
      ? "Competition score: not measured"
      : `Competition score (0-100, share of the panel that bids): ${ev.competitionScore}`,
    `Demand signals behind this candidate: ${ev.signalCount}`
  ];
}

export function whitespaceBriefMessages(
  ev: WhitespaceEvidence,
  nouns: PromptNouns
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        `You turn one unserved-market finding into a marketing brief for a ${nouns.domain} business. ` +
        "The finding is a category with measured demand and few or no active " +
        `${nouns.contracts} of the tenant's own. Reply with JSON only, matching the schema: name ` +
        "(a short internal campaign name), objective (acq for a category the tenant barely sells, " +
        "renewal for keeping existing customers, xsell for selling into the existing book), " +
        "proposition (one line a buyer would understand), and brief (what the creative should say " +
        "and the angle to take, 2-4 sentences). " +
        "State no number the evidence below did not give you, and never promise cover, acceptance, " +
        "a price, or that the tenant is cheapest — a human reviews and launches this, you only draft it."
    },
    { role: "user", content: whitespaceEvidenceLines(ev, nouns).join("\n") }
  ];
}

const FIELDS = ["name", "objective", "proposition", "brief"] as const;

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/**
 * Parses one model reply. Never throws.
 *
 * Returns null — rather than a partial brief — in two cases, because both make
 * the reply unusable rather than merely thin:
 *
 *  1. A required prose field is missing or the wrong type. A campaign with no
 *     name or an empty brief is not a smaller campaign, it is not one.
 *  2. The reply states a number the evidence did not contain. That is the
 *     CLAUDE.md rule 11 inspectability gate: the same `verifyGroundedness` the
 *     AXIS copilot and the ORBIT drafter use, over the same lines the prompt
 *     sent. A brief citing an invented demand figure would be persisted, shown
 *     with a ✦, and then generate creative copy off the invention.
 *
 * `objective` is different: an out-of-enum objective is a *classification* the
 * caller can safely default (a category with demand and no book is acquisition
 * by construction), so it degrades to "acq" and only costs confidence.
 */
export function parseWhitespaceBrief(
  reply: string,
  ev: WhitespaceEvidence,
  nouns: PromptNouns
): WhitespaceBrief | null {
  const parsed = parseJsonObject(reply) ?? {};

  const name = text(parsed.name, 80);
  const proposition = text(parsed.proposition, 200);
  const brief = text(parsed.brief, 2_000);
  if (name === null || proposition === null || brief === null) return null;

  const rawObjective = parsed.objective;
  const objective = CAMPAIGN_OBJECTIVES.find((o) => o === rawObjective);

  if (!verifyGroundedness([name, proposition, brief].join("\n"), whitespaceEvidenceLines(ev, nouns)).ok) return null;

  // name/proposition/brief are non-null past the guard above, so `objective` is
  // the only field that can be absent — 100 with it, 75 without.
  const present = FIELDS.length - (objective === undefined ? 1 : 0);
  return {
    name,
    objective: objective ?? "acq",
    proposition,
    brief,
    confidence: Math.round((present / FIELDS.length) * 100)
  };
}

/**
 * The brief used when the model is unreachable, slow, or ungrounded. Deterministic
 * and evidence-only: it states the two numbers the candidate was flagged on and
 * nothing else, so a promotion never blocks on a model call (docs/15 §4 — AI
 * drafts, it does not gate) and never persists an unevidenced sentence.
 */
export function fallbackWhitespaceBrief(ev: WhitespaceEvidence, nouns: PromptNouns): WhitespaceBrief {
  return {
    name: `${ev.category} — unserved demand`,
    objective: "acq",
    proposition: `${ev.category}: demand we see, cover we do not yet sell.`,
    brief:
      `Demand momentum ${ev.momentum} on ${ev.category} against ${ev.coverage} active ` +
      `${nouns.contracts} on the book. Draft copy that introduces the category; a human sets ` +
      "the offer and the channel.",
    confidence: 0
  };
}
