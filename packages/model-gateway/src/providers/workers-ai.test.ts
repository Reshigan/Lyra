import { describe, expect, it } from "vitest";
import { base64ToBytes, textOf, workersAi } from "./workers-ai.js";

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

describe("base64ToBytes", () => {
  it("round-trips through btoa/atob", () => {
    const original = new Uint8Array([0, 1, 2, 254, 255, 16]);
    const b64 = btoa(String.fromCharCode(...original));
    expect(base64ToBytes(b64)).toEqual(original);
  });
});

describe("workersAi.generateImage", () => {
  it("decodes the base64 image field via base64ToBytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const b64 = btoa(String.fromCharCode(...bytes));
    const env = { AI: { run: async () => ({ image: b64 }) } };
    const out = await workersAi.generateImage!("a logo", "@cf/black-forest-labs/flux-1-schnell", env as never);
    expect(out.bytes).toEqual(bytes);
    expect(out.contentType).toBe("image/png");
  });

  it("throws when the AI binding is missing", async () => {
    await expect(workersAi.generateImage!("a logo", "model", {} as never)).rejects.toThrow("AI binding missing");
  });

  it("throws when the response has no image field", async () => {
    const env = { AI: { run: async () => ({}) } };
    await expect(workersAi.generateImage!("a logo", "model", env as never)).rejects.toThrow("no image in response");
  });
});
