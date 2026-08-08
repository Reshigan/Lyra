// docs/modules/axis.md §8, docs/04 §4 "documents(+extract)". The structuring
// step for AXIS document intake: turn OCR'd/raw text into the named fields a
// human would otherwise type off the document by hand. Kept in this package,
// not in apps/api, so the parsing evals/axis scores is the exact parsing the
// route runs (packages/model-gateway/evals/axis/cases.jsonl -> run.ts).
//
// AXIS §G.5: when the caller has no `rawText`, the route renders pages to
// images and calls the vision variants below instead — see
// visionExtractionSchema/visionExtractionMessages/parseVisionExtraction.

/** The only two doc types docs/modules/axis.md §8 puts a threshold on. */
export const EXTRACTION_FIELDS: Record<string, readonly string[]> = {
  eid: ["fullName", "idNumber", "dateOfBirth", "expiryDate", "nationality"],
  mulkiya: ["plateNumber", "ownerName", "vehicleModel", "registrationExpiry"]
};

/**
 * Extracted fields that are national identifiers or account details, and so are
 * sealed before they touch the database (docs/12 §1, ADR-0032). Listed by field
 * name rather than by doc type: the day a bank-statement doc type arrives, its
 * `iban` is covered the moment it is named here.
 *
 * `plateNumber` is deliberately absent — it identifies a vehicle, is printed on
 * the outside of one, and every quote screen shows it.
 */
export const SENSITIVE_EXTRACTION_FIELDS: ReadonlySet<string> = new Set([
  "idNumber",
  "iban",
  "accountNumber"
]);

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

/**
 * The extraction prompt, in one place. docs/27 F10: the live eval must send the
 * prompt production sends, or it measures a prompt nobody runs — so the route
 * (apps/api/src/routes/axis.ts) and evals/live-extraction both call this.
 */
export function extractionMessages(input: {
  docType: string;
  fields: readonly string[];
  locale: string;
  rawText: string;
}): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        `Extract these fields from the ${input.docType} document text below and reply with ` +
        `JSON only, matching the schema: ${input.fields.join(", ")}. Locale: ${input.locale}.`
    },
    { role: "user", content: input.rawText }
  ];
}

/** Models sometimes wrap JSON in a code fence despite `responseSchema`; strip it before parsing. */
export function stripFence(text: string): string {
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

/**
 * A field value plus where on the page it was read, or all-null if unread.
 * `page` is evidence only (documents are rendered page 1 only today, see
 * axis-document-render.ts) — the route drops it before storage. `bbox` is
 * kept, as `[x, y, width, height]` percent of the page (apps/web's
 * axis-doc-intel.tsx `_bbox`/`bboxOf` contract, not pixels).
 */
export interface FieldEvidence {
  value: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
}

export interface VisionExtraction {
  values: Record<string, FieldEvidence>;
  /** Same heuristic as Extraction.confidence, but "present" requires evidence, not just a value. */
  confidence: number;
}

/** JSON schema for the vision path: each field carries its evidence, not just its value. */
export function visionExtractionSchema(fields: readonly string[]): Record<string, unknown> {
  const evidence = {
    type: "object",
    properties: {
      value: { type: ["string", "null"] },
      page: { type: ["integer", "null"] },
      bbox: { type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4 }
    },
    required: ["value", "page", "bbox"]
  };
  return {
    name: "axis_document_fields_vision",
    schema: {
      type: "object",
      properties: Object.fromEntries(fields.map((f) => [f, evidence])),
      required: [...fields]
    }
  };
}

/** Same prompt contract as extractionMessages, but points at the attached page image, not rawText. */
export function visionExtractionMessages(input: {
  docType: string;
  fields: readonly string[];
  locale: string;
}): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        `Extract these fields from the attached ${input.docType} document image and reply with JSON only, ` +
        `matching the schema: ${input.fields.join(", ")}. Locale: ${input.locale}. For each field return its ` +
        `value plus the page number and bounding box [x, y, width, height] as percentages of the page (0-100), ` +
        `where you read it. If a field is not visible or you are not certain, set value, page and bbox to ` +
        `null — never guess.`
    },
    { role: "user", content: `Extract the ${input.docType} fields from the attached image.` }
  ];
}

/**
 * Parses one vision reply. hallucinatedFieldRateMax: 0.0 (docs/modules/axis.md §8) means a
 * value the model did not also point at with page+bbox is dropped rather than trusted — a
 * plausible-looking string with no evidence is exactly what that threshold exists to catch.
 */
export function parseVisionExtraction(reply: string, fields: readonly string[]): VisionExtraction {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripFence(reply)) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const values: Record<string, FieldEvidence> = {};
  let present = 0;
  for (const field of fields) {
    const raw = (parsed[field] ?? {}) as Partial<FieldEvidence>;
    const value = typeof raw.value === "string" ? raw.value.trim() : "";
    const page = typeof raw.page === "number" ? raw.page : null;
    const bbox =
      Array.isArray(raw.bbox) && raw.bbox.length === 4 && raw.bbox.every((n) => typeof n === "number")
        ? (raw.bbox as [number, number, number, number])
        : null;

    const hasEvidence = value !== "" && page !== null && bbox !== null;
    values[field] = hasEvidence ? { value, page, bbox } : { value: null, page: null, bbox: null };
    if (hasEvidence) present += 1;
  }

  return { values, confidence: fields.length ? Math.round((present / fields.length) * 100) : 0 };
}
