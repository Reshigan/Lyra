import { describe, expect, it } from "vitest";
import { humanise, labelsFor, optionLabel, type WorkspaceSpec } from "./spec";

// Enum values reach the renderer as raw tokens (`pending_settlement`), and the
// workspaces spell their labels two different ways — qualified by the column
// (distribution, ledger) and bare (orbit, signal, admin, …). One resolver has
// to satisfy both and still never show a person a snake_case token.

const spec = (labels: Record<string, string>): WorkspaceSpec => ({
  path: "/test",
  labels: { en: labels },
  tabs: []
});

const labelFor = (labels: Record<string, string>) => labelsFor(spec(labels), "en");

describe("optionLabel", () => {
  it("prefers the qualified key over the bare one", () => {
    const label = labelFor({ "state.open": "Open for bids", open: "Open" });
    expect(optionLabel(label, "state", "open")).toBe("Open for bids");
  });

  it("falls back to the bare key when the qualified one is absent", () => {
    const label = labelFor({ open: "Open" });
    expect(optionLabel(label, "state", "open")).toBe("Open");
  });

  it("humanises the raw value when neither key exists", () => {
    const label = labelFor({});
    expect(optionLabel(label, "state", "pending_settlement")).toBe("Pending settlement");
    expect(optionLabel(label, "state", "awaitingDocs")).toBe("Awaiting docs");
  });

  it("leaves an already-human value alone", () => {
    const label = labelFor({});
    expect(optionLabel(label, "state", "Settled")).toBe("Settled");
  });

  it("never returns a bare i18n key", () => {
    const label = labelFor({});
    for (const value of ["b2c", "pending_settlement", "issue"]) {
      expect(optionLabel(label, "kind", value)).not.toContain(".");
      expect(optionLabel(label, "kind", value)).not.toContain("_");
    }
  });
});

describe("humanise", () => {
  it("keeps an empty value as-is rather than inventing one", () => {
    expect(humanise("")).toBe("");
  });
});
