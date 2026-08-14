import { describe, expect, it } from "vitest";
import { LABELS, PERM, channelLede, labelsIn, sellsFor } from "./channel-detail";
import type { OfferingRow } from "./channel-detail";

// Read-only screen: no action to exercise. The one piece of logic is which
// offerings this channel may sell — there is no `?channelId=` on offerings, the
// allow-list is a JSON column, so the filter happens here and must not
// accidentally hand a channel something it is not allowed to quote.

function offering(id: string, channelKeysJson: unknown): OfferingRow {
  return { id, code: id, nameJson: null, channelKeysJson } as OfferingRow;
}

describe("labelsIn", () => {
  it("answers every key in both languages, and never with the key itself", () => {
    for (const key of Object.keys(LABELS.en!)) {
      expect(LABELS.ar![key], key).toBeTruthy();
      for (const locale of ["en", "ar"]) expect(labelsIn(locale)(key), `${locale}:${key}`).not.toBe(key);
    }
    expect(Object.keys(LABELS.ar!).sort()).toEqual(Object.keys(LABELS.en!).sort());
  });

  it("keeps the Arabic distinct from the English", () => {
    for (const [key, value] of Object.entries(LABELS.en!)) expect(LABELS.ar![key], key).not.toBe(value);
  });

  it("names every settlement state a row can be in", () => {
    for (const state of ["draft", "approved", "paid", "disputed"]) {
      expect(labelsIn("en")(`state.${state}`)).not.toBe(`state.${state}`);
      expect(labelsIn("ar")(`state.${state}`)).not.toBe(`state.${state}`);
    }
  });
});

describe("channelLede", () => {
  it("states the kind, medium, status and live-request count from the loaded record", () => {
    expect(channelLede({ kind: "b2c", medium: "web", status: "active" }, 4, labelsIn("en"))).toBe(
      "Direct · Website · Active · 4 live requests"
    );
  });
});

describe("PERM", () => {
  it("scopes each panel to its own permission so one refusal hides one panel", () => {
    const values = Object.values(PERM);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => /^[a-z_]+:[a-z_]+:[a-z_]+$/.test(value))).toBe(true);
  });
});

describe("sellsFor", () => {
  it("keeps only the offerings whose allow-list names this channel", () => {
    const rows = [offering("a", ["web", "broker"]), offering("b", ["app"]), offering("c", ["broker"])];
    expect(sellsFor("broker", rows).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("excludes an offering with no allow-list, since the screen cannot prove it is sellable here", () => {
    expect(sellsFor("broker", [offering("a", null), offering("b", undefined)])).toEqual([]);
  });

  it("survives a malformed allow-list", () => {
    expect(sellsFor("broker", [offering("a", "broker"), offering("b", { broker: true })])).toEqual([]);
  });

  it("matches the key exactly, never a prefix", () => {
    expect(sellsFor("broker", [offering("a", ["broker-uae"])])).toEqual([]);
  });
});
