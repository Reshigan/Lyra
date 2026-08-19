import { describe, expect, it } from "vitest";
import { COMPLEXITY_BANDS, parseTriage, triageMessages, triageSchema } from "./triage.js";

describe("parseTriage", () => {
  it("strips a ```json fence", () => {
    const body = JSON.stringify({ perilCode: "fire", causeCode: "negligence", complexity: "complex" });
    expect(parseTriage("```json\n" + body + "\n```")).toEqual({
      perilCode: "fire",
      causeCode: "negligence",
      complexity: "complex",
      confidence: 100
    });
  });

  // Regression: see fraud.test.ts — valid JSON that is not an object used to throw.
  it.each(["null", "42", '"a string"'])("returns the zero result for valid non-object JSON: %s", (reply) => {
    expect(() => parseTriage(reply)).not.toThrow();
    expect(parseTriage(reply)).toEqual({ perilCode: null, causeCode: null, complexity: null, confidence: 0 });
  });
});

describe("triageSchema", () => {
  it("requires all three fields and pins complexity to the band vocabulary", () => {
    expect(triageSchema()).toEqual({
      name: "axis_fnol_triage",
      schema: {
        type: "object",
        properties: {
          perilCode: { type: "string" },
          causeCode: { type: "string" },
          complexity: { type: "string", enum: ["fast_track", "standard", "complex", "litigated"] }
        },
        required: ["perilCode", "causeCode", "complexity"]
      }
    });
  });

  // The literal above is the contract; this pins it to the same list parseTriage
  // validates against, so a new band cannot be added to one side only.
  it("offers exactly the bands parseTriage accepts", () => {
    const schema = triageSchema().schema as { properties: { complexity: { enum: string[] } } };
    expect(schema.properties.complexity.enum).toEqual([...COMPLEXITY_BANDS]);
  });
});

describe("triageMessages", () => {
  const description = "Driver rear-ended a parked car in the rain; no injuries.";
  const system = (): string => triageMessages(description)[0]!.content;

  it("sends the rules as system and the description verbatim as user", () => {
    const messages = triageMessages(description);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe(description);
  });

  it("asks for JSON only and a slug per code field, with examples", () => {
    expect(system()).toMatch(/Read the loss description below and classify it/);
    expect(system()).toMatch(/JSON only, matching the schema/);
    expect(system()).toMatch(/perilCode \(a short slug for what kind of peril caused the loss, e\.g\. collision/);
    expect(system()).toMatch(/causeCode \(a short slug for the proximate cause, e\.g\. third_party/);
  });

  it("lists the bands comma-separated and gives each one its rule", () => {
    expect(system()).toContain(`one of: ${COMPLEXITY_BANDS.join(", ")}`);
    expect(system()).toMatch(/litigated only if the text names a lawyer or lawsuit/);
    expect(system()).toMatch(/complex only for injury, fatality, or multi-party loss/);
    expect(system()).toMatch(/fast_track for routine single-party low-severity loss, standard otherwise/);
  });
});
