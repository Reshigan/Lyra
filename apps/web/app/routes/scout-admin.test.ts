import { describe, expect, it } from "vitest";
import { currentThresholds, floorOverrides, healthOf, QUIET_AFTER_DAYS, type ThresholdRow } from "./scout-admin";
import { K_FLOOR, type Page } from "./scout.shared";

// The screen makes three claims and nothing else: a source is quiet or it is
// not, a threshold row is the live one or a superseded one, and a product's
// floor either is the module's or is its own. Each is worth pinning because
// each would be silently wrong rather than visibly broken.

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;

const page = (rows: Array<{ id: string; source: string; observedAt: number }>, total?: number): Page<{
  id: string;
  source: string;
  observedAt: number;
}> => (total === undefined ? { data: rows } : { data: rows, total });

/* --------------------------------------------------------- source health */

describe("source health", () => {
  it("takes the count from the envelope total, not the one row it fetched", () => {
    // The read asks for limit=1 with a count; using data.length would report
    // every ingesting source as having exactly one signal.
    const health = healthOf("search", page([{ id: "sig_1", source: "search", observedAt: NOW - DAY }], 4_812), NOW);
    expect(health.count).toBe(4_812);
    expect(health.lastAt).toBe(NOW - DAY);
    expect(health.quiet).toBe(false);
  });

  it("reads a source that has never delivered as quiet, not as fresh", () => {
    const health = healthOf("regulatory", page([]), NOW);
    expect(health.count).toBe(0);
    expect(health.lastAt).toBeNull();
    expect(health.quiet).toBe(true);
  });

  it("goes quiet on the silence, however large the lifetime volume is", () => {
    const stale = healthOf(
      "quotes",
      page([{ id: "sig_9", source: "quotes", observedAt: NOW - (QUIET_AFTER_DAYS + 1) * DAY }], 900_000),
      NOW
    );
    expect(stale.quiet).toBe(true);
    const justInside = healthOf(
      "quotes",
      page([{ id: "sig_9", source: "quotes", observedAt: NOW - (QUIET_AFTER_DAYS - 1) * DAY }], 3),
      NOW
    );
    expect(justInside.quiet).toBe(false);
  });

  it("falls back to the rows it has when the count was withheld", () => {
    expect(healthOf("news", page([{ id: "sig_2", source: "news", observedAt: NOW }]), NOW).count).toBe(1);
  });
});

/* ------------------------------------------------------------ thresholds */

const threshold = (over: Partial<ThresholdRow> = {}): ThresholdRow => ({
  id: "pth_1",
  key: "scout.whitespace_promote",
  version: 1,
  valueJson: '{"amount":25000000,"currency":"AED"}',
  dualControl: false,
  effectiveFrom: NOW - 90 * DAY,
  effectiveTo: null,
  setBy: "usr_owner",
  ...over
});

describe("policy thresholds", () => {
  it("keeps only the module's own keys", () => {
    const rows = currentThresholds([threshold(), threshold({ id: "pth_2", key: "ledger.refund" })]);
    expect(rows.map((row) => row.key)).toEqual(["scout.whitespace_promote"]);
  });

  it("shows the live version, not the newest row, when an old one is still on file", () => {
    // A superseded row keeps its effective_to; reading by id or by max version
    // alone would show a limit nobody enforces any more.
    const rows = currentThresholds([
      threshold({ id: "pth_a", version: 2, valueJson: '{"amount":50000000}' }),
      threshold({ id: "pth_b", version: 1, effectiveTo: NOW - 30 * DAY })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.valueJson).toBe('{"amount":50000000}');
  });

  it("reads a fully superseded key as unset rather than as its last value", () => {
    expect(currentThresholds([threshold({ effectiveTo: NOW - DAY })])).toEqual([]);
  });

  it("orders keys so the list does not reshuffle between loads", () => {
    const rows = currentThresholds([
      threshold({ id: "p1", key: "scout.whitespace_promote" }),
      threshold({ id: "p2", key: "scout.data_product_publish" })
    ]);
    expect(rows.map((row) => row.key)).toEqual(["scout.data_product_publish", "scout.whitespace_promote"]);
  });
});

/* ---------------------------------------------------------------- floors */

describe("suppression floors", () => {
  it("lists only the products that depart from the module floor, thinnest first", () => {
    const rows = floorOverrides([
      { id: "dtp_1", name: "Demand curve", aggregationMin: K_FLOOR, status: "published" },
      { id: "dtp_2", name: "Latency bench", aggregationMin: 200, status: "suspended" },
      { id: "dtp_3", name: "Churn signals", aggregationMin: 5, status: "draft" }
    ]);
    expect(rows.map((row) => row.id)).toEqual(["dtp_3", "dtp_2"]);
  });

  it("says nothing when every product inherits", () => {
    expect(floorOverrides([{ id: "dtp_1", name: "Demand curve", aggregationMin: K_FLOOR, status: "draft" }])).toEqual(
      []
    );
  });
});
