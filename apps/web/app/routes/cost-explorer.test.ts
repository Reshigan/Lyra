import { describe, expect, it } from "vitest";
import {
  DRIFT_BASELINE_DAYS,
  DRIFT_THRESHOLD_PCT,
  driftFor,
  driftingUnits,
  groupByUnit,
  type UnitEconRow
} from "./cost-explorer";

// ADM-025: unit-cost drift alerting. One question this file answers: does a
// unit that suddenly costs more than its trailing baseline get flagged, and
// does a unit that's merely noisy (or has no history yet) stay quiet.

const row = (over: Partial<UnitEconRow> = {}): UnitEconRow => ({
  id: `ue_${over.day ?? "x"}`,
  day: "2026-07-30",
  module: "orbit",
  unit: "conversation",
  volume: 10,
  aiCostMicro: 0,
  mediaCostMicro: 0,
  humanMinutes: 0,
  revenueMinor: 0,
  currency: "USD",
  updatedAt: 0,
  costMinor: 0,
  costPerUnitMinor: 100,
  marginMinor: 0,
  ...over
});

describe("groupByUnit", () => {
  it("keys rows by module/unit, preserving arrival order within a group", () => {
    const rows = [
      row({ id: "a", module: "orbit", unit: "conversation", day: "2026-07-30" }),
      row({ id: "b", module: "axis", unit: "case", day: "2026-07-30" }),
      row({ id: "c", module: "orbit", unit: "conversation", day: "2026-07-29" })
    ];
    const groups = groupByUnit(rows);
    expect([...groups.keys()]).toEqual(["orbit/conversation", "axis/case"]);
    expect(groups.get("orbit/conversation")?.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("driftFor", () => {
  it("returns null with fewer than two priced days — no baseline to compare against", () => {
    expect(driftFor("orbit", "conversation", [row({ costPerUnitMinor: 100 })])).toBeNull();
  });

  it("returns null when the latest day never priced the unit", () => {
    const rows = [row({ costPerUnitMinor: null }), row({ costPerUnitMinor: 100, day: "2026-07-29" })];
    expect(driftFor("orbit", "conversation", rows)).toBeNull();
  });

  it("flags a latest day that costs well above its trailing baseline", () => {
    const rows = [
      row({ day: "2026-07-30", costPerUnitMinor: 200 }),
      row({ day: "2026-07-29", costPerUnitMinor: 100 }),
      row({ day: "2026-07-28", costPerUnitMinor: 100 })
    ];
    const drift = driftFor("orbit", "conversation", rows);
    expect(drift?.deltaPct).toBe(100);
    expect(drift?.baselineMinor).toBe(100);
  });

  it("ignores baseline days beyond the window", () => {
    const rows = [
      row({ day: "d0", costPerUnitMinor: 100 }),
      ...Array.from({ length: DRIFT_BASELINE_DAYS }, (_, i) => row({ day: `b${i}`, costPerUnitMinor: 100 })),
      row({ day: "far", costPerUnitMinor: 1_000_000 })
    ];
    expect(driftFor("orbit", "conversation", rows)?.deltaPct).toBe(0);
  });
});

describe("driftingUnits", () => {
  it("only surfaces units past the threshold, worst first", () => {
    const rows = [
      row({ id: "hot-1", module: "orbit", unit: "conversation", day: "2026-07-30", costPerUnitMinor: 300 }),
      row({ id: "hot-2", module: "orbit", unit: "conversation", day: "2026-07-29", costPerUnitMinor: 100 }),
      row({ id: "steady-1", module: "axis", unit: "case", day: "2026-07-30", costPerUnitMinor: 105 }),
      row({ id: "steady-2", module: "axis", unit: "case", day: "2026-07-29", costPerUnitMinor: 100 }),
      row({ id: "worse-1", module: "north", unit: "brief", day: "2026-07-30", costPerUnitMinor: 1000 }),
      row({ id: "worse-2", module: "north", unit: "brief", day: "2026-07-29", costPerUnitMinor: 100 })
    ];
    const drifts = driftingUnits(rows, DRIFT_THRESHOLD_PCT);
    expect(drifts.map((d) => `${d.module}/${d.unit}`)).toEqual(["north/brief", "orbit/conversation"]);
  });

  it("stays quiet with no rows", () => {
    expect(driftingUnits([])).toEqual([]);
  });
});
