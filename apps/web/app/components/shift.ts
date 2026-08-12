import { policyTitle } from "../policy";

// The two Horizon compositions that read the same queue: the shift rail (what
// is waiting on you, in order, with a ring saying how much of the day is
// behind you) and the Meridian strip (the same events, laid on the day they
// happened on). Both are pure functions of /v1/me/inbox so they can be tested
// without a browser — see shift.test.ts.

export const DAY_MS = 86_400_000;

/** 2πr for the 16px ring the rail header draws. */
export const RING_CIRCUMFERENCE = 100.53;

export interface InboxApproval {
  id: string;
  policyKey: string;
  module: string;
  requestedAt: number;
}

export interface InboxNotification {
  id: string;
  kind: string;
  titleKey: string;
  createdAt: number;
}

export interface Inbox {
  approvals: InboxApproval[];
  notifications: InboxNotification[];
  counts: { approvals: number; notifications: number; clearedToday: number };
}

export interface ShiftItem {
  id: string;
  /** "01", "02" — the rail numbers the queue so a shift has a shape. */
  ordinal: string;
  module: string;
  title: string;
  at: number;
}

export interface Shift {
  /** Decided by this actor since the start of the day (API: counts.clearedToday). */
  done: number;
  /** Still waiting on them. */
  open: number;
  /** `stroke-dasharray` for the progress ring. */
  dash: string;
  items: ShiftItem[];
}

/**
 * How much of the ring is swept. A ring fed only by what is still open could
 * never say anything but "nothing done", which is why the inbox reports both
 * halves. Nothing at all — no work today — leaves the ring empty rather than
 * claiming a full one.
 */
export function ringDash(done: number, open: number): string {
  const total = done + open;
  const swept = total > 0 ? (done / total) * RING_CIRCUMFERENCE : 0;
  return `${swept.toFixed(2)} ${RING_CIRCUMFERENCE}`;
}

/**
 * The rail's list: every approval waiting on this actor, oldest first, because
 * a shift is worked in the order it arrived. Capped at nine — a rail is a
 * shift, not a queue screen, and /approvals holds the rest.
 */
export function shiftFrom(inbox: Inbox | null | undefined, limit = 9): Shift | null {
  if (!inbox) return null;
  const open = inbox.counts?.approvals ?? inbox.approvals.length;
  const done = inbox.counts?.clearedToday ?? 0;
  const items = [...inbox.approvals]
    .sort((a, b) => a.requestedAt - b.requestedAt)
    .slice(0, limit)
    .map((approval, i) => ({
      id: approval.id,
      ordinal: String(i + 1).padStart(2, "0"),
      module: approval.module,
      title: policyTitle(approval.policyKey, approval.module),
      at: approval.requestedAt
    }));
  return { done, open, dash: ringDash(done, open), items };
}

export interface DayEvent {
  id: string;
  at: number;
  module: string;
  /** Whether this dot is close enough to its neighbours to have to go unlabelled. */
  labelled: boolean;
}

/**
 * Where in the day a moment sits, 0 at midnight and 1 at the next. Read in the
 * reader's own zone, which is why the strip only draws its events after mount:
 * a Worker renders in UTC and the two passes would disagree.
 */
export function dayFraction(at: number): number {
  const when = new Date(at);
  return (when.getHours() * 60 + when.getMinutes()) / 1440;
}

/**
 * The dots on the strip: everything that landed in the reader's today, oldest
 * first. Approvals and notifications both — the strip is what happened, not
 * what is outstanding.
 *
 * `minGap` is a fraction of the day: two events closer than that would print
 * their labels on top of each other, so the later one keeps its dot and loses
 * its words.
 */
export function dayEvents(inbox: Inbox | null | undefined, now: number, minGap = 0.045): DayEvent[] {
  if (!inbox) return [];
  const today = dayFraction(now);
  const raw = [
    ...inbox.approvals.map((a) => ({ id: a.id, at: a.requestedAt, module: a.module })),
    ...inbox.notifications.map((n) => ({ id: n.id, at: n.createdAt, module: moduleOfKind(n.kind) }))
  ]
    .filter((event) => sameDay(event.at, now) && dayFraction(event.at) <= today)
    .sort((a, b) => a.at - b.at);

  let lastLabel = Number.NEGATIVE_INFINITY;
  return raw.map((event) => {
    const at = dayFraction(event.at);
    const labelled = at - lastLabel >= minGap;
    if (labelled) lastLabel = at;
    return { ...event, labelled };
  });
}

/** Same calendar day in the reader's zone — not the same 24 hours. */
export function sameDay(a: number, b: number): boolean {
  const one = new Date(a);
  const two = new Date(b);
  return (
    one.getFullYear() === two.getFullYear() &&
    one.getMonth() === two.getMonth() &&
    one.getDate() === two.getDate()
  );
}

/**
 * A notification's kind is `module.thing.happened` (packages/core notify()), so
 * its hue is the first segment. Anything that does not name a module gets the
 * tenant accent rather than a guess.
 */
export function moduleOfKind(kind: string): string {
  return kind.split(".")[0] ?? "";
}
