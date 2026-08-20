/**
 * The NORTH step of the flagship journey read `highlightsJson` as `string[]`
 * and printed `narrativeRef` verbatim. Against live data that rendered
 * "0 Highlights" and a storage key where the briefing should be. Both are
 * contract bugs — the tests below are written against what the server sends,
 * not against what the screen assumed.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.server", () => ({ api: vi.fn() }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { highlightsOf } from "./journey-north";

/** One row as apps/api/src/engines/narrator.ts writes it. */
const row = (highlightsJson: unknown) => ({
  id: "brf_1",
  date: "2026-08-12",
  audience: "exec",
  locale: "en",
  narrativeRef: "Motor closed the month above every prior month.",
  highlightsJson,
  status: "published",
  createdAt: 0
});

describe("highlightsOf", () => {
  it("reads the objects the API actually sends", () => {
    const sent = [
      { metricKey: "gwp", period: "2026-07", value: 238_900_000, deltaBps: 1_841, note: "Led by motor." },
      { metricKey: "quote_to_bind_rate", period: "2026-08-11", value: 1_890, deltaBps: -1_923 }
    ];
    expect(highlightsOf(row(sent))).toEqual(sent);
    expect(highlightsOf(row(JSON.stringify(sent)))).toEqual(sent);
  });

  it("keeps nothing that is not a highlight, and survives a bad column", () => {
    expect(highlightsOf(row(["gwp", "renewal_retention"]))).toEqual([]);
    expect(highlightsOf(row(null))).toEqual([]);
    expect(highlightsOf(row("{not json"))).toEqual([]);
    expect(highlightsOf(row({ metricKey: "gwp" }))).toEqual([]);
    expect(highlightsOf(null)).toEqual([]);
  });
});
