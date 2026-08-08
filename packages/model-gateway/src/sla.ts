// docs/specs/gap-axis-design.md §G.4. SLA-breach prediction: given a case's
// age, status, state history from axis_process_events, queue depth and owner
// load, estimate how likely the case is to miss its SLA and why.
//
// Ambient, not consequential (CLAUDE.md §4): generation only. The model may
// not reassign work (axis:cases:assign, human-only), extend an SLA, reorder a
// queue, or draft a chase — those are the future Prioritiser/Chaser (§G.6,
// ADR-0035 pending); this module only produces the estimate they would
// consume. hoursToBreach itself is not asked of the model — axis_cases.slaDueAt
// is already an exact fact, so apps/api/src/engines/axis-sla-sentinel.ts
// computes it deterministically rather than have the model guess a number we
// already have.

export interface SlaProcessEvent {
  step: string;
  outcome: string | null;
  durationMs: number | null;
  ts: number;
}

export interface SlaContext {
  kind: string;
  status: string;
  priority: string;
  ageMs: number;
  hoursUntilDue: number | null;
  history: SlaProcessEvent[];
  queueDepth: number;
  ownerLoad: number;
}

export interface SlaBreachDriver {
  feature: string;
  detail: string;
  evidenceRef: string;
}

export interface SlaBreachEstimate {
  /** 0-100. Zero whenever no driver survives evidence-checking — see parseSla. */
  breachProbability: number;
  /** evidenceRef-bearing only, or null. "A driver with no evidenceRef is dropped — no unexplainable prediction." */
  driver: SlaBreachDriver | null;
  /** 0-100. Schema-conformance heuristic, same basis as fraud.ts's `FraudScoreResult.confidence`. */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function slaSchema(): Record<string, unknown> {
  return {
    name: "axis_case_sla_breach_estimate",
    schema: {
      type: "object",
      properties: {
        breachProbability: { type: "integer" },
        driver: {
          type: "object",
          properties: {
            feature: { type: "string" },
            detail: { type: "string" },
            evidenceRef: { type: "string" }
          },
          required: ["feature", "detail", "evidenceRef"]
        }
      },
      required: ["breachProbability", "driver"]
    }
  };
}

/**
 * The SLA-breach prompt, in one place, shared verbatim between the eval
 * harness and the production engine (apps/api/src/engines/axis-sla-sentinel.ts),
 * per docs/27 F10's "the live eval must send the prompt production sends."
 */
export function slaMessages(ctx: SlaContext): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You are estimating whether an operations case will breach its SLA, from its kind, status, priority, " +
        "age, hours remaining until the SLA is due, its recent process step history, how many other cases share " +
        "its status (queue depth), and how many open cases its owner already carries (owner load). Reply with " +
        "JSON only, matching the schema: breachProbability (0-100, how likely the case misses its SLA) and " +
        "driver, a single object naming the one observed feature that most explains the estimate — feature, a " +
        "short slug; detail, a human-readable comparison such as 'awaiting docs 6 days, median for this peril is " +
        "2'; and evidenceRef, the specific fact from the input that supports it — a history step, queueDepth, or " +
        "ownerLoad. The driver must name its evidence; never invent one you cannot point to evidence for. Never " +
        "return a breachProbability above 0 with no driver — an unexplained prediction is not a prediction."
    },
    { role: "user", content: JSON.stringify(ctx) }
  ];
}

/** Models sometimes wrap JSON in a code fence despite `responseSchema`; strip it before parsing. */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

const FIELDS = ["breachProbability", "driver"] as const;

/** Parses one model reply. Never throws — a bad reply predicts nothing. */
export function parseSla(reply: string): SlaBreachEstimate {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripFence(reply)) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const rawProbability = parsed.breachProbability;
  const rawDriver = parsed.driver;

  let driver: SlaBreachDriver | null = null;
  if (typeof rawDriver === "object" && rawDriver !== null) {
    const { feature, detail, evidenceRef } = rawDriver as Record<string, unknown>;
    if (
      typeof feature === "string" &&
      feature.trim().length > 0 &&
      typeof detail === "string" &&
      detail.trim().length > 0 &&
      typeof evidenceRef === "string" &&
      evidenceRef.trim().length > 0
    ) {
      driver = { feature, detail, evidenceRef };
    }
  }

  const rawProbabilityNum =
    typeof rawProbability === "number" && Number.isFinite(rawProbability)
      ? Math.max(0, Math.min(100, Math.round(rawProbability)))
      : 0;

  // No unexplainable predictions: a probability with no surviving, evidenced driver is not a prediction.
  const breachProbability = driver ? rawProbabilityNum : 0;

  const present = [typeof rawProbability === "number", driver !== null].filter(Boolean).length;
  return {
    breachProbability,
    driver,
    confidence: Math.round((present / FIELDS.length) * 100)
  };
}
