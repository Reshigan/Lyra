import { describe, expect, test } from "vitest";
import { Message, ToolDef } from "./types";

describe("Message", () => {
  test("accepts every role in the enum", () => {
    for (const role of ["system", "user", "assistant", "tool"] as const) {
      expect(Message.parse({ role, content: "hi" })).toEqual({ role, content: "hi" });
    }
  });

  test("rejects a role outside the enum", () => {
    expect(() => Message.parse({ role: "narrator", content: "hi" })).toThrow();
  });

  test("requires content", () => {
    expect(() => Message.parse({ role: "user" })).toThrow();
  });

  test("carries optional toolCallId and name", () => {
    const parsed = Message.parse({ role: "tool", content: "42", toolCallId: "call_1", name: "lookup" });
    expect(parsed).toEqual({ role: "tool", content: "42", toolCallId: "call_1", name: "lookup" });
  });
});

describe("ToolDef", () => {
  const base = { name: "lookup", description: "look something up", parameters: { type: "object" } };

  test("requires name, description and parameters", () => {
    expect(() => ToolDef.parse({})).toThrow();
    expect(() => ToolDef.parse({ description: "x", parameters: {} })).toThrow();
    expect(() => ToolDef.parse({ name: "x", parameters: {} })).toThrow();
    expect(() => ToolDef.parse({ name: "x", description: "x" })).toThrow();
  });

  test("defaults consequential to false", () => {
    expect(ToolDef.parse(base).consequential).toBe(false);
  });

  test("keeps an explicit consequential: true", () => {
    expect(ToolDef.parse({ ...base, consequential: true }).consequential).toBe(true);
  });
});
