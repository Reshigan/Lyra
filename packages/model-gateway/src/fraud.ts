import { parseJsonObject } from "./parse.js";

// docs/specs/gap-axis-design.md §G.2. Fraud/SIU scoring: given a claim, its
// policy cover snapshot, the holder's own claim history, and any document
// extraction results, score how referable the claim is to SIU and name the
// evidence for each point.
//
// Ambient, not consequential (CLAUDE.md §4; spec's "Not consequential" list
// names SIU referral creation explicitly): a referral is a queue entry, never
// a declinature. The model may not set claims.status, reduce a reserve, or
// block a payment — apps/api/src/engines/axis-fraud-scorer.ts only inserts an
// axis_siu_referrals row for a human investigator to act on.

export interface FraudHistoryClaim {
  id: string;
  perilCode: string | null;
  status: string;
  amountMinor: number | null;
  settledMinor: number | null;
  closedAt: number | null;
}

export interface FraudDocument {
  id: string;
  docType: string | null;
  extractionConfidence: number | null;
}

export interface FraudContext {
  perilCode: string | null;
  causeCode: string | null;
  incidentAt: number | null;
  reportedAt: number;
  amountMinor: number | null;
  limits: Record<string, number> | null;
  history: FraudHistoryClaim[];
  documents: FraudDocument[];
}

export interface FraudIndicator {
  code: string;
  weight: number;
  evidenceRef: string;
}

export interface FraudScoreResult {
  /** 0-100. Zero whenever no indicator survives evidence-checking — see parseFraud. */
  score: number;
  /** evidenceRef-bearing only. "An indicator with no evidenceRef is dropped before scoring — no unexplainable points." */
  indicators: FraudIndicator[];
  /** Indicators the model named but gave no usable evidenceRef for — dropped, never scored. */
  droppedIndicatorCount: number;
  /** 0-100. Schema-conformance heuristic, same basis as reserve.ts's `ReserveRecommendation.confidence`. */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function fraudSchema(): Record<string, unknown> {
  return {
    name: "axis_claim_fraud_score",
    schema: {
      type: "object",
      properties: {
        score: { type: "integer" },
        indicators: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              weight: { type: "number" },
              evidenceRef: { type: "string" }
            },
            required: ["code", "weight", "evidenceRef"]
          }
        }
      },
      required: ["score", "indicators"]
    }
  };
}

/**
 * The fraud-scoring prompt, in one place, shared verbatim between the eval
 * harness and the production engine (apps/api/src/engines/axis-fraud-scorer.ts),
 * per docs/27 F10's "the live eval must send the prompt production sends."
 */
export function fraudMessages(ctx: FraudContext): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You are scoring an insurance claim for referral to the Special Investigation Unit (SIU), from its " +
        "peril, cause, the gap between incident and report, the claimed amount against policy limits, the " +
        "holder's own prior claim history, and any document extraction results. Reply with JSON only, matching " +
        "the schema: score (0-100, how strongly the claim looks referable) and indicators (each with code, a " +
        "short slug naming the signal; weight, its contribution to the score; and evidenceRef, the specific " +
        "fact from the input that supports it — a prior claim id, document id, or field name). Every indicator " +
        "must name its evidence; never invent one you cannot point to evidence for. Never return a score above " +
        "0 with an empty indicators array — an unexplained score is not a score."
    },
    { role: "user", content: JSON.stringify(ctx) }
  ];
}

const FIELDS = ["score", "indicators"] as const;

/** Parses one model reply. Never throws — a bad reply scores nothing. */
export function parseFraud(reply: string): FraudScoreResult {
  const parsed = parseJsonObject(reply) ?? {};

  const rawScore = parsed.score;
  const rawIndicators = parsed.indicators;

  const candidates = Array.isArray(rawIndicators)
    ? rawIndicators.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];

  const indicators: FraudIndicator[] = [];
  for (const raw of candidates) {
    const code = raw.code;
    const weight = raw.weight;
    const evidenceRef = raw.evidenceRef;
    if (
      typeof code === "string" &&
      code.trim().length > 0 &&
      typeof weight === "number" &&
      Number.isFinite(weight) &&
      typeof evidenceRef === "string" &&
      evidenceRef.trim().length > 0
    ) {
      indicators.push({ code, weight, evidenceRef });
    }
  }

  const rawScoreNum =
    typeof rawScore === "number" && Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

  // No unexplainable points: a score with no surviving, evidenced indicator is not a score.
  const score = indicators.length > 0 ? rawScoreNum : 0;

  const present = [typeof rawScore === "number", Array.isArray(rawIndicators)].filter(Boolean).length;
  return {
    score,
    indicators,
    droppedIndicatorCount: candidates.length - indicators.length,
    confidence: Math.round((present / FIELDS.length) * 100)
  };
}
