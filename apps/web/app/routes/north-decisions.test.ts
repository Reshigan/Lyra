import { describe, expect, it } from "vitest";
import { optionsFrom, queueState, readOptions } from "./north-decisions";

const DAY = 86_400_000;
const NOW = 1_770_000_000_000;

describe("queueState", () => {
  it("calls a decision overdue once its review date is more than a day past", () => {
    expect(queueState({ status: "open", reviewAt: NOW - 3 * DAY }, NOW)).toBe("overdue");
  });

  it("calls it due on the day itself, so the nag is not a day late", () => {
    expect(queueState({ status: "open", reviewAt: NOW }, NOW)).toBe("due");
    expect(queueState({ status: "open", reviewAt: NOW - 2 * 3600_000 }, NOW)).toBe("due");
  });

  it("warns a fortnight out and stays quiet beyond it", () => {
    expect(queueState({ status: "open", reviewAt: NOW + 10 * DAY }, NOW)).toBe("soon");
    expect(queueState({ status: "open", reviewAt: NOW + 30 * DAY }, NOW)).toBeNull();
  });

  it("never queues a decision that has already been answered", () => {
    expect(queueState({ status: "reviewed", reviewAt: NOW - 90 * DAY }, NOW)).toBeNull();
    expect(queueState({ status: "reversed", reviewAt: NOW - 90 * DAY }, NOW)).toBeNull();
  });

  it("never queues a decision nobody set a date on — there is nothing to be late for", () => {
    expect(queueState({ status: "open", reviewAt: null }, NOW)).toBeNull();
  });
});

describe("readOptions", () => {
  it("reads the seeded shape, whether the column arrives as text or as an object", () => {
    const seeded = [
      { key: "hold", label: "Hold the panel rate" },
      { key: "renegotiate", label: "Renegotiate", costMinor: 240_000 }
    ];
    expect(readOptions(JSON.stringify(seeded))).toEqual([
      { key: "hold", label: "Hold the panel rate" },
      { key: "renegotiate", label: "Renegotiate" }
    ]);
    expect(readOptions(seeded)).toEqual(readOptions(JSON.stringify(seeded)));
  });

  it("reads a bare string list, so a hand-written row still shows its options", () => {
    expect(readOptions(["Hold", " Renegotiate ", ""])).toEqual([
      { key: "Hold", label: "Hold" },
      { key: "Renegotiate", label: "Renegotiate" }
    ]);
  });

  it("falls back to the key when an entry has no label", () => {
    expect(readOptions([{ key: "hold" }])).toEqual([{ key: "hold", label: "hold" }]);
  });

  it("returns nothing rather than throwing when the column holds junk", () => {
    expect(readOptions(null)).toEqual([]);
    expect(readOptions("not json")).toEqual([]);
    expect(readOptions({ key: "hold" })).toEqual([]);
    expect(readOptions([null, 7, {}])).toEqual([]);
  });
});

describe("optionsFrom", () => {
  it("makes one keyed option per typed line and drops the blanks", () => {
    expect(optionsFrom("Hold the panel rate\n\n  Renegotiate 2027  \n")).toEqual([
      { key: "hold_the_panel_rate", label: "Hold the panel rate" },
      { key: "renegotiate_2027", label: "Renegotiate 2027" }
    ]);
  });

  it("returns nothing for an empty box, so an unopinionated decision logs cleanly", () => {
    expect(optionsFrom("")).toEqual([]);
    expect(optionsFrom("   \n  ")).toEqual([]);
  });
});
