import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LABELS, SCALE_MAX, csatScale } from "./portal.$tenantSlug.feedback.$id";

// J-C2's CSAT tap. The scale comes off the API rather than being hard-coded in
// the markup, so the buttons cannot drift from the column orbit-analytics.tsx
// averages — that drift is the failure this file exists to catch.

describe("csatScale", () => {
  it("draws the scale the API reports", () => {
    expect(csatScale(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("matches the analytics screen's 1-5 by default", () => {
    expect(SCALE_MAX).toBe(5);
    expect(csatScale(SCALE_MAX)).toHaveLength(5);
  });

  it("still renders a usable page on a corrupt or absent scale", () => {
    for (const bad of [0, 1, -3, 99, 4.5, Number.NaN, undefined as unknown as number]) {
      expect(csatScale(bad), String(bad)).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

describe("the page carries the tenant's brand, never ours", () => {
  it("has no hard-coded platform name anywhere in the surface", () => {
    const source = readFileSync(join(import.meta.dirname, "portal.$tenantSlug.feedback.$id.tsx"), "utf8");
    expect(source).not.toMatch(/\bLYRA\b/);
    expect(source).not.toMatch(/\bHorizon\b/);
    for (const table of Object.values(LABELS)) {
      for (const value of Object.values(table)) expect(value).not.toMatch(/LYRA/i);
    }
  });

  it("asks nothing about the conversation itself", () => {
    // The link holder is authenticated as nobody: a label that named the agent
    // or quoted the transcript would leak on a surface with no session.
    for (const table of Object.values(LABELS)) {
      for (const value of Object.values(table)) expect(value).not.toMatch(/transcript|agent name/i);
    }
  });
});

describe("this screen's own labels speak both locales", () => {
  it("has the same keys in en and ar", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
  });

  it("never leaves an Arabic string empty or identical to the English", () => {
    for (const [key, english] of Object.entries(LABELS.en ?? {})) {
      const arabic = LABELS.ar?.[key] ?? "";
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
    }
  });
});
