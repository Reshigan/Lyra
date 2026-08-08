// docs/specs/gap-axis-design.md §G.1. FNOL triage: fill `perilCode`/`causeCode`/
// `complexity` from the free-text `description` when the human notifying the
// loss left them blank. Kept in this package, not in apps/api, for the same
// reason as extract.ts — the eval scores the exact prompt production runs.
//
// Ambient, not consequential (CLAUDE.md §4): triage only fills gaps a human
// left blank, never overwrites a value someone typed, and a failed or
// low-confidence call must never block claim registration (docs §D.1,
// "refusing to record a notification is a conduct failure").

/** `axis_claims.complexity` (packages/db/src/schema/axis.ts). */
export const COMPLEXITY_BANDS = ["fast_track", "standard", "complex", "litigated"] as const;
export type ComplexityBand = (typeof COMPLEXITY_BANDS)[number];

export interface Triage {
  perilCode: string | null;
  causeCode: string | null;
  /** null when the model's reply did not name a recognised band. */
  complexity: ComplexityBand | null;
  /** 0-100. Schema-conformance heuristic, same basis as extract.ts's `Extraction.confidence`. */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function triageSchema(): Record<string, unknown> {
  return {
    name: "axis_fnol_triage",
    schema: {
      type: "object",
      properties: {
        perilCode: { type: "string" },
        causeCode: { type: "string" },
        complexity: { type: "string", enum: [...COMPLEXITY_BANDS] }
      },
      required: ["perilCode", "causeCode", "complexity"]
    }
  };
}

/**
 * The triage prompt, in one place, shared verbatim between the eval harness
 * and the production route (apps/api/src/engines/axis-fnol.ts), per docs/27
 * F10's "the live eval must send the prompt production sends."
 */
export function triageMessages(description: string): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "Read the loss description below and classify it. Reply with JSON only, matching the schema: " +
        "perilCode (a short slug for what kind of peril caused the loss, e.g. collision, fire, theft, water_damage), " +
        "causeCode (a short slug for the proximate cause, e.g. third_party, weather, negligence, mechanical_failure), " +
        `complexity (one of: ${COMPLEXITY_BANDS.join(", ")} — litigated only if the text names a lawyer or lawsuit, ` +
        "complex only for injury, fatality, or multi-party loss, fast_track for routine single-party low-severity loss, standard otherwise)."
    },
    { role: "user", content: description }
  ];
}

/** Models sometimes wrap JSON in a code fence despite `responseSchema`; strip it before parsing. */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

const FIELDS = ["perilCode", "causeCode", "complexity"] as const;

/** Parses one model reply. Never throws — a bad reply triages nothing. */
export function parseTriage(reply: string): Triage {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripFence(reply)) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const rawPeril = parsed.perilCode;
  const rawCause = parsed.causeCode;
  const rawComplexity = parsed.complexity;

  const perilCode = typeof rawPeril === "string" && rawPeril.trim() ? rawPeril.trim() : null;
  const causeCode = typeof rawCause === "string" && rawCause.trim() ? rawCause.trim() : null;
  const complexity =
    typeof rawComplexity === "string" && (COMPLEXITY_BANDS as readonly string[]).includes(rawComplexity)
      ? (rawComplexity as ComplexityBand)
      : null;

  const present = [perilCode, causeCode, complexity].filter((v) => v !== null).length;
  return { perilCode, causeCode, complexity, confidence: Math.round((present / FIELDS.length) * 100) };
}
