// docs/modules/axis.md §8, docs/04 §4 "documents(+extract)". The structuring
// step for AXIS document intake: turn OCR'd/raw text into the named fields a
// human would otherwise type off the document by hand. Kept in this package,
// not in apps/api, so the parsing evals/axis scores is the exact parsing the
// route runs (packages/model-gateway/evals/axis/cases.jsonl -> run.ts).
//
// ponytail: text-in, JSON-out only. No image/vision content part exists on
// `Message` (types.ts) and none of the three provider adapters accept one —
// that is a separate, larger change. Real pipelines already split OCR from
// field structuring, so the caller supplies the already-OCR'd text.

/** The only two doc types docs/modules/axis.md §8 puts a threshold on. */
export const EXTRACTION_FIELDS: Record<string, readonly string[]> = {
  eid: ["fullName", "idNumber", "dateOfBirth", "expiryDate", "nationality"],
  mulkiya: ["plateNumber", "ownerName", "vehicleModel", "registrationExpiry"]
};

export interface Extraction {
  /** null where the model omitted the field or the reply did not parse at all. */
  values: Record<string, string | null>;
  /**
   * 0-100. Heuristic: the fraction of the requested fields the model actually
   * returned a non-empty value for. This is a schema-conformance signal, not a
   * measured accuracy — a human still confirms the row via
   * `POST /axis/documents/:id/verify` before it is trusted (docs/07 §3).
   */
  confidence: number;
}

/** JSON schema handed to `ModelRequest.responseSchema` (gateway.ts, docs/02 §5). */
export function extractionSchema(fields: readonly string[]): Record<string, unknown> {
  return {
    name: "axis_document_fields",
    schema: {
      type: "object",
      properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
      required: [...fields]
    }
  };
}

/** Models sometimes wrap JSON in a code fence despite `responseSchema`; strip it before parsing. */
function stripFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

/** Parses one model reply against the fields it was asked for. Never throws. */
export function parseExtraction(reply: string, fields: readonly string[]): Extraction {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripFence(reply)) as Record<string, unknown>;
  } catch {
    // A reply that does not parse extracts nothing — not a thrown error, so one
    // bad document does not fail the whole request.
    parsed = {};
  }

  const values: Record<string, string | null> = {};
  let present = 0;
  for (const field of fields) {
    const raw = parsed[field];
    const s = typeof raw === "string" ? raw.trim() : "";
    values[field] = s || null;
    if (values[field]) present += 1;
  }

  return { values, confidence: fields.length ? Math.round((present / fields.length) * 100) : 0 };
}

/** trim + case-fold, so the eval scorer and any UI diff do not fail on whitespace or case alone. */
export function normalizeField(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}
