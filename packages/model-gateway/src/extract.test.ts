import { describe, expect, it } from "vitest";
import {
  EXTRACTION_FIELDS,
  SENSITIVE_EXTRACTION_FIELDS,
  extractionMessages,
  extractionSchema,
  normalizeField,
  parseExtraction,
  parseVisionExtraction,
  stripFence,
  visionExtractionMessages,
  visionExtractionSchema
} from "./extract.js";

describe("EXTRACTION_FIELDS", () => {
  it("covers the two doc types docs/modules/axis.md §8 puts a threshold on", () => {
    expect(EXTRACTION_FIELDS.eid).toEqual(["fullName", "idNumber", "dateOfBirth", "expiryDate", "nationality"]);
    expect(EXTRACTION_FIELDS.mulkiya).toEqual(["plateNumber", "ownerName", "vehicleModel", "registrationExpiry"]);
  });
});

describe("extractionSchema", () => {
  it("builds a json-schema object with one string property per field, all required", () => {
    const schema = extractionSchema(["a", "b"]) as { schema: { properties: object; required: string[] } };
    expect(schema.schema.properties).toEqual({ a: { type: "string" }, b: { type: "string" } });
    expect(schema.schema.required).toEqual(["a", "b"]);
  });
});

describe("extractionMessages", () => {
  // Regression: the live eval lost `idNumber` on both noisy Emirates ID cases
  // because the card serial is the only other number on the page and a bare
  // field name gives the model nothing to choose with (eval-live 2026-08-10,
  // fieldAccuracy.en/.ar = 0.929 against a 0.95 floor).
  it("tells the model which number is the ID number", () => {
    const [system] = extractionMessages({
      docType: "eid",
      fields: EXTRACTION_FIELDS.eid!,
      locale: "en",
      rawText: "ID No 784-2001-7654325-9 ... card no 1234567"
    });
    expect(system!.content).toMatch(/idNumber:.*never the card serial/);
    expect(system!.content).toMatch(/exactly as printed/);
  });

  it("carries the same field wording into the response schema, for providers that forward it", () => {
    const schema = extractionSchema(["idNumber"]) as {
      schema: { properties: { idNumber: { description?: string } } };
    };
    expect(schema.schema.properties.idNumber.description).toMatch(/card serial/);
  });
});

describe("parseExtraction", () => {
  const fields = ["fullName", "idNumber"] as const;

  it("parses a clean JSON reply", () => {
    const { values, confidence } = parseExtraction('{"fullName":"Ahmed","idNumber":"123"}', fields);
    expect(values).toEqual({ fullName: "Ahmed", idNumber: "123" });
    expect(confidence).toBe(100);
  });

  it("strips a markdown code fence some models wrap the JSON in despite responseSchema", () => {
    const { values } = parseExtraction('```json\n{"fullName":"Ahmed","idNumber":"123"}\n```', fields);
    expect(values).toEqual({ fullName: "Ahmed", idNumber: "123" });
  });

  it("nulls out a field the model omitted, without throwing", () => {
    const { values, confidence } = parseExtraction('{"fullName":"Ahmed"}', fields);
    expect(values).toEqual({ fullName: "Ahmed", idNumber: null });
    expect(confidence).toBe(50);
  });

  it("treats an unparseable reply as no fields extracted, without throwing", () => {
    const { values, confidence } = parseExtraction("not json at all", fields);
    expect(values).toEqual({ fullName: null, idNumber: null });
    expect(confidence).toBe(0);
  });

  it("trims whitespace and blanks out empty-string values", () => {
    const { values } = parseExtraction('{"fullName":"  Ahmed  ","idNumber":"   "}', fields);
    expect(values).toEqual({ fullName: "Ahmed", idNumber: null });
  });
});

describe("SENSITIVE_EXTRACTION_FIELDS", () => {
  it("seals national identifiers and account details, not the vehicle plate", () => {
    expect([...SENSITIVE_EXTRACTION_FIELDS].sort()).toEqual(["accountNumber", "iban", "idNumber"]);
    // A plate identifies a vehicle, is printed on the outside of one, and every
    // quote screen shows it — sealing it would break those screens for nothing.
    expect(SENSITIVE_EXTRACTION_FIELDS.has("plateNumber")).toBe(false);
  });
});

describe("stripFence", () => {
  it("returns the body of a fenced block, without the fence", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("accepts a fence with no language tag", () => {
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns unfenced text trimmed, unchanged otherwise", () => {
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("takes only the first fenced block when a model emits prose around two", () => {
    expect(stripFence('here:\n```\nfirst\n```\nand\n```\nsecond\n```')).toBe("first");
  });
});

describe("extractionMessages", () => {
  it("puts the raw document text in the user turn and the instructions in the system turn", () => {
    const messages = extractionMessages({
      docType: "mulkiya",
      fields: ["plateNumber"],
      locale: "ar",
      rawText: "DXB A 123"
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("mulkiya");
    expect(messages[0]!.content).toContain("Locale: ar");
    expect(messages[1]).toEqual({ role: "user", content: "DXB A 123" });
  });

  it("lists a field with no wording as a bare name rather than dropping it", () => {
    const [system] = extractionMessages({
      docType: "other",
      fields: ["mysteryField"],
      locale: "en",
      rawText: ""
    });
    expect(system!.content).toContain("- mysteryField");
  });
});

describe("visionExtractionSchema", () => {
  it("asks for value, page and bbox per field, all required", () => {
    const schema = visionExtractionSchema(["idNumber"]) as {
      name: string;
      schema: { properties: Record<string, { properties: object; required: string[] }>; required: string[] };
    };
    expect(schema.name).toBe("axis_document_fields_vision");
    expect(schema.schema.required).toEqual(["idNumber"]);
    const evidence = schema.schema.properties.idNumber!;
    expect(evidence.required).toEqual(["value", "page", "bbox"]);
    expect(evidence.properties).toEqual({
      value: { type: ["string", "null"] },
      page: { type: ["integer", "null"] },
      // Four numbers exactly: [x, y, width, height] as percent of the page.
      bbox: { type: ["array", "null"], items: { type: "number" }, minItems: 4, maxItems: 4 }
    });
  });
});

describe("visionExtractionMessages", () => {
  it("points the model at the attached image and forbids guessing", () => {
    const messages = visionExtractionMessages({ docType: "eid", fields: ["idNumber"], locale: "en" });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("attached eid document image");
    expect(messages[0]!.content).toContain("Locale: en");
    expect(messages[0]!.content).toMatch(/idNumber:.*never the card serial/);
    expect(messages[0]!.content).toMatch(/never guess/);
    expect(messages[1]).toEqual({
      role: "user",
      content: "Extract the eid fields from the attached image."
    });
  });
});

describe("parseVisionExtraction", () => {
  const fields = ["fullName", "idNumber"] as const;
  const evidence = (value: string) => ({ value, page: 1, bbox: [10, 20, 30, 40] });

  it("keeps a value the model pointed at with page and bbox", () => {
    const reply = JSON.stringify({ fullName: evidence("Ahmed"), idNumber: evidence("784-1") });
    const { values, confidence } = parseVisionExtraction(reply, fields);
    expect(values.fullName).toEqual({ value: "Ahmed", page: 1, bbox: [10, 20, 30, 40] });
    expect(values.idNumber!.value).toBe("784-1");
    expect(confidence).toBe(100);
  });

  // hallucinatedFieldRateMax: 0.0 (docs/modules/axis.md §8) — a plausible string
  // with no evidence behind it is exactly what that threshold exists to catch.
  it("drops a value with no page", () => {
    const reply = JSON.stringify({ fullName: { value: "Ahmed", page: null, bbox: [1, 2, 3, 4] } });
    const { values, confidence } = parseVisionExtraction(reply, ["fullName"]);
    expect(values.fullName).toEqual({ value: null, page: null, bbox: null });
    expect(confidence).toBe(0);
  });

  it("drops a value with no bbox", () => {
    const reply = JSON.stringify({ fullName: { value: "Ahmed", page: 1, bbox: null } });
    expect(parseVisionExtraction(reply, ["fullName"]).values.fullName).toEqual({
      value: null,
      page: null,
      bbox: null
    });
  });

  it("drops a bbox that is not four numbers", () => {
    const short = JSON.stringify({ fullName: { value: "Ahmed", page: 1, bbox: [1, 2, 3] } });
    expect(parseVisionExtraction(short, ["fullName"]).confidence).toBe(0);
    const wrongType = JSON.stringify({ fullName: { value: "Ahmed", page: 1, bbox: [1, 2, 3, "4"] } });
    expect(parseVisionExtraction(wrongType, ["fullName"]).confidence).toBe(0);
  });

  it("drops evidence that points at a whitespace-only value", () => {
    const reply = JSON.stringify({ fullName: { value: "   ", page: 1, bbox: [1, 2, 3, 4] } });
    expect(parseVisionExtraction(reply, ["fullName"]).values.fullName!.value).toBeNull();
  });

  it("scores partial evidence against the fields asked for", () => {
    const reply = JSON.stringify({ fullName: evidence("Ahmed"), idNumber: { value: "784-1" } });
    const { values, confidence } = parseVisionExtraction(reply, fields);
    expect(values.idNumber).toEqual({ value: null, page: null, bbox: null });
    expect(confidence).toBe(50);
  });

  it("returns all-null evidence for a field the model omitted entirely", () => {
    const { values } = parseVisionExtraction(JSON.stringify({ fullName: evidence("Ahmed") }), fields);
    expect(values.idNumber).toEqual({ value: null, page: null, bbox: null });
  });

  it("treats an unparseable reply as no fields extracted, without throwing", () => {
    const { values, confidence } = parseVisionExtraction("not json at all", fields);
    expect(values.fullName).toEqual({ value: null, page: null, bbox: null });
    expect(confidence).toBe(0);
  });

  it("strips a code fence the same way the text path does", () => {
    const reply = "```json\n" + JSON.stringify({ fullName: evidence("Ahmed") }) + "\n```";
    expect(parseVisionExtraction(reply, ["fullName"]).confidence).toBe(100);
  });

  it("scores an empty field list as zero rather than dividing by zero", () => {
    expect(parseVisionExtraction("{}", []).confidence).toBe(0);
    expect(parseExtraction("{}", []).confidence).toBe(0);
  });
});

describe("normalizeField", () => {
  it("trims and case-folds", () => {
    expect(normalizeField("  DXB A 123  ")).toBe("dxb a 123");
  });

  it("treats null and empty string as equal", () => {
    expect(normalizeField(null)).toBe(normalizeField(""));
  });
});
