import { describe, expect, it } from "vitest";
import { EXTRACTION_FIELDS, extractionSchema, normalizeField, parseExtraction } from "./extract.js";

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
