import { describe, expect, it } from "vitest";
import { textOf } from "./workers-ai.js";

// A schema'd call ran green against the real endpoint but died downstream on
// "input.text.match is not a function" (checks/eval-live, run 31409565224):
// with `response_format: json_schema` Workers AI returns the answer parsed.
// Everything after the provider — guardrails, rehydrate, every parse* helper —
// treats `result.text` as a string.

describe("textOf", () => {
  it("passes a plain string answer through", () => {
    expect(textOf({ response: "hello" })).toBe("hello");
    expect(textOf({ result: { response: "hello" } })).toBe("hello");
  });

  it("re-serialises a schema'd object answer instead of returning it raw", () => {
    expect(textOf({ result: { response: { policyNo: "P-1" } } })).toBe('{"policyNo":"P-1"}');
    expect(textOf({ response: { policyNo: "P-1" } })).toBe('{"policyNo":"P-1"}');
  });

  it("is an empty string when the model answered with nothing", () => {
    expect(textOf({})).toBe("");
    expect(textOf({ result: { response: null } })).toBe("");
  });
});
