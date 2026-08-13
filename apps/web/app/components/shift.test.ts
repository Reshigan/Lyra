import { describe, expect, it } from "vitest";
import {
  dayEvents,
  dayFraction,
  inboxAsOf,
  meridianState,
  moduleOfKind,
  ringDash,
  sameDay,
  scrubFraction,
  shiftFrom,
  type Inbox
} from "./shift";

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

  it("tells two decisions of the same kind apart by their subject", () => {
    const shift = shiftFrom(
      inbox({
        approvals: [
          {
            id: "a",
            policyKey: "axis.cancel",
            module: "axis",
            subjectRef: "cases:cs_01hzzzzzzzzzzzzzzzzzzzzzzz",
            requestedAt: today(9)
          },
          {
            id: "b",
            policyKey: "axis.cancel",
            module: "axis",
            subjectRef: "policies:new:0123456789abcdef0123456789abcdef",
            requestedAt: today(10)
          }
        ],
        counts: { approvals: 2, notifications: 0, clearedToday: 0 }
      }),
      { "cases:cs_01hzzzzzzzzzzzzzzzzzzzzzzz": "CDR-MOT-2601-778201" }
    );
    expect(shift?.items.map((i) => [i.title, i.subject])).toEqual([
      ["Cancel", "CDR-MOT-2601-778201"],
      ["Cancel", "New policies"]
    ]);
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

describe("scrubFraction", () => {
  const rect = { left: 100, width: 400 };

  it("reads the pointer as a position in the day", () => {
    expect(scrubFraction(100, rect)).toBe(0);
    expect(scrubFraction(300, rect)).toBe(0.5);
    expect(scrubFraction(500, rect)).toBe(1);
  });

  it("clamps a drag that leaves the strip instead of running off the day", () => {
    expect(scrubFraction(-40, rect)).toBe(0);
    expect(scrubFraction(9000, rect)).toBe(1);
  });

  it("starts the day at the right edge when the tenant reads right to left", () => {
    expect(scrubFraction(500, rect, true)).toBe(0);
    expect(scrubFraction(100, rect, true)).toBe(1);
  });

  it("does not divide by a strip that has not been laid out yet", () => {
    expect(scrubFraction(120, { left: 0, width: 0 })).toBe(0);
  });
});

describe("meridianState", () => {
  it("calls the present live rather than a replay of the last minute", () => {
    expect(meridianState(0.5, 0.5)).toBe("live");
    expect(meridianState(0.505, 0.5)).toBe("live");
  });

  it("names which side of now the playhead is on", () => {
    expect(meridianState(0.2, 0.5)).toBe("replay");
    expect(meridianState(0.8, 0.5)).toBe("projection");
  });
});

describe("inboxAsOf", () => {
  const at = today(11);
  const full = inbox({
    approvals: [
      { id: "early", policyKey: "axis.bind", module: "axis", requestedAt: today(9) },
      { id: "late", policyKey: "axis.bind", module: "axis", requestedAt: today(15) }
    ],
    notifications: [
      { id: "seen", kind: "orbit.x", titleKey: "n.x", createdAt: today(10) },
      { id: "unseen", kind: "orbit.x", titleKey: "n.x", createdAt: today(14) }
    ],
    counts: { approvals: 2, notifications: 2, clearedToday: 5 }
  });

  it("shows the queue as it stood, not as it ended up", () => {
    const past = inboxAsOf(full, at)!;
    expect(past.approvals.map((a) => a.id)).toEqual(["early"]);
    expect(past.notifications.map((n) => n.id)).toEqual(["seen"]);
    expect(past.counts.approvals).toBe(1);
  });

  it("leaves the day's cleared total alone rather than inventing when each clear landed", () => {
    expect(inboxAsOf(full, at)!.counts.clearedToday).toBe(5);
  });

  it("stays null when the inbox could not be read", () => {
    expect(inboxAsOf(null, at)).toBeNull();
  });
});
