import { describe, expect, it } from "vitest";
import { dayEvents, dayFraction, moduleOfKind, ringDash, sameDay, shiftFrom, type Inbox } from "./shift";

// The shift rail and the day strip both read /v1/me/inbox. What is worth
// testing is not the markup but the three judgements underneath: how far the
// ring is swept, what order the shift is worked in, and which events belong to
// the reader's today.

/** A local-time moment today, so the tests read the same clock the component does. */
function today(hour: number, minute = 0): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function inbox(patch: Partial<Inbox> = {}): Inbox {
  return {
    approvals: [],
    notifications: [],
    counts: { approvals: 0, notifications: 0, clearedToday: 0 },
    ...patch
  };
}

describe("ringDash", () => {
  it("sweeps the share of the day's work already decided", () => {
    const [swept] = ringDash(3, 1).split(" ").map(Number);
    expect(swept).toBeCloseTo(75.4, 1);
  });

  it("stays empty when nothing has happened, rather than claiming a full ring", () => {
    expect(ringDash(0, 0).startsWith("0.00 ")).toBe(true);
  });
});

describe("shiftFrom", () => {
  it("numbers the queue oldest first and names each item by its policy", () => {
    const shift = shiftFrom(
      inbox({
        approvals: [
          { id: "b", policyKey: "axis.claim_payment", module: "axis", requestedAt: today(11) },
          { id: "a", policyKey: "orbit.discount", module: "orbit", requestedAt: today(9) }
        ],
        counts: { approvals: 2, notifications: 0, clearedToday: 2 }
      })
    );
    expect(shift?.items.map((i) => [i.ordinal, i.id, i.title])).toEqual([
      ["01", "a", "Discount"],
      ["02", "b", "Claim payment"]
    ]);
    expect(shift?.open).toBe(2);
    expect(shift?.done).toBe(2);
  });

  it("shows a shift, not a queue screen — the rest lives on /approvals", () => {
    const approvals = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      policyKey: "axis.cancel",
      module: "axis",
      requestedAt: today(8) + i * 60_000
    }));
    const shift = shiftFrom(inbox({ approvals, counts: { approvals: 12, notifications: 0, clearedToday: 0 } }));
    expect(shift?.items).toHaveLength(9);
    expect(shift?.open).toBe(12);
  });

  it("is absent when the inbox could not be read, so the rail can omit itself", () => {
    expect(shiftFrom(null)).toBeNull();
  });
});

describe("dayFraction", () => {
  it("places midnight at the start of the strip and noon halfway along it", () => {
    expect(dayFraction(today(0, 0))).toBe(0);
    expect(dayFraction(today(12, 0))).toBeCloseTo(0.5, 5);
  });
});

describe("sameDay", () => {
  it("compares calendar days, not the last 24 hours", () => {
    expect(sameDay(today(1), today(23))).toBe(true);
    expect(sameDay(today(1) - 86_400_000, today(1))).toBe(false);
  });
});

describe("dayEvents", () => {
  const now = today(15);

  it("lays approvals and notifications on the same day, oldest first, and drops yesterday", () => {
    const events = dayEvents(
      inbox({
        approvals: [
          { id: "old", policyKey: "axis.cancel", module: "axis", requestedAt: today(9) - 86_400_000 },
          { id: "noon", policyKey: "axis.cancel", module: "axis", requestedAt: today(12) }
        ],
        notifications: [
          { id: "morning", kind: "orbit.quote.won", titleKey: "n.x", createdAt: today(9) }
        ]
      }),
      now
    );
    expect(events.map((e) => e.id)).toEqual(["morning", "noon"]);
    expect(events.map((e) => e.module)).toEqual(["orbit", "axis"]);
  });

  it("does not draw the future — a strip that runs past the playhead is a lie", () => {
    const events = dayEvents(
      inbox({ notifications: [{ id: "later", kind: "north.x", titleKey: "n.x", createdAt: today(18) }] }),
      now
    );
    expect(events).toEqual([]);
  });

  it("keeps the dot but drops the label when two events would collide", () => {
    const events = dayEvents(
      inbox({
        notifications: [
          { id: "first", kind: "north.x", titleKey: "n.x", createdAt: today(9, 0) },
          { id: "crowded", kind: "north.x", titleKey: "n.x", createdAt: today(9, 10) },
          { id: "clear", kind: "north.x", titleKey: "n.x", createdAt: today(13, 0) }
        ]
      }),
      now
    );
    expect(events.map((e) => e.labelled)).toEqual([true, false, true]);
  });
});

describe("moduleOfKind", () => {
  it("takes the hue from the segment that names a module", () => {
    expect(moduleOfKind("axis.case.assigned")).toBe("axis");
    expect(moduleOfKind("welcome")).toBe("welcome");
  });
});
