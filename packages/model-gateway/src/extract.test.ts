import { describe, expect, it } from "vitest";
import {
  EXTRACTION_FIELDS,
  extractionMessages,
  extractionSchema,
  normalizeField,
  parseExtraction
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

describe("normalizeField", () => {
  it("trims and case-folds", () => {
    expect(normalizeField("  DXB A 123  ")).toBe("dxb a 123");
  });

  it("treats null and empty string as equal", () => {
    expect(normalizeField(null)).toBe(normalizeField(""));
  });
});
