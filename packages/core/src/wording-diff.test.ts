import { describe, expect, it } from "vitest";
import { diffWords } from "./wording-diff.js";

// docs/modules/scout.md — the Wording Differ: catch a seeded coverage-term
// change between two policy/clause texts, word by word.

describe("diffWords", () => {
  it("marks unchanged text as equal when both texts are identical", () => {
    const out = diffWords("flood damage is covered", "flood damage is covered");
    expect(out).toEqual([{ type: "equal", text: "flood damage is covered" }]);
  });

  it("flags an inserted span", () => {
    const out = diffWords("flood damage is covered", "flood and storm damage is covered");
    expect(out).toEqual([
      { type: "equal", text: "flood" },
      { type: "insert", text: "and storm" },
      { type: "equal", text: "damage is covered" }
    ]);
  });

  it("flags a removed span", () => {
    const out = diffWords("flood and storm damage is covered", "flood damage is covered");
    expect(out).toEqual([
      { type: "equal", text: "flood" },
      { type: "delete", text: "and storm" },
      { type: "equal", text: "damage is covered" }
    ]);
  });

  it("flags a changed span as a delete immediately followed by an insert", () => {
    // The exact acceptance case: a coverage term silently narrowed.
    const before = "water damage up to 100000 is covered";
    const after = "water damage up to 50000 is covered";
    const out = diffWords(before, after);
    expect(out).toEqual([
      { type: "equal", text: "water damage up to" },
      { type: "delete", text: "100000" },
      { type: "insert", text: "50000" },
      { type: "equal", text: "is covered" }
    ]);
  });

  it("treats an empty original as a pure insertion", () => {
    expect(diffWords("", "new clause text")).toEqual([{ type: "insert", text: "new clause text" }]);
  });

  it("treats an empty revision as a pure deletion", () => {
    expect(diffWords("old clause text", "")).toEqual([{ type: "delete", text: "old clause text" }]);
  });
});
