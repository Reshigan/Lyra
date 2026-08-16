// @vitest-environment jsdom
// Pin the local timezone before any other import touches `Date`, so the
// epoch-ms -> local-hour-fraction math below is deterministic regardless of
// the machine running the suite.
process.env.TZ = "UTC";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { dayFraction } from "./shift";
import { Meridian } from "./meridian";

describe("Meridian initialAsOf", () => {
  it("seeds the scrubber cursor from initialAsOf when provided", async () => {
    // A real epoch-ms timestamp, per the prop's contract (?asOf=<epoch-ms>) —
    // not a bare day-fraction. dayFraction() reads local hours/minutes, and
    // TZ is pinned to UTC above, so this is 12:00 local on the nose.
    const asOf = new Date("2024-01-15T12:00:00.000Z").getTime();
    const expectedValue = Math.round(dayFraction(asOf) * 1440); // 720 for noon

    const { container } = render(
      <Meridian t={(key) => key} inbox={null} accent="var(--module-north)" initialAsOf={asOf} onScrub={vi.fn()} />
    );

    // The seed happens in a post-mount effect (Worker SSR renders in UTC, so
    // local-time math is deferred, same as `now`) — wait for it to land.
    await waitFor(() => {
      const slider = container.querySelector('[role="slider"]');
      expect(slider?.getAttribute("aria-valuenow")).toBe(String(expectedValue));
    });
  });

  it("defaults to live (no cursor) when initialAsOf is absent", async () => {
    render(<Meridian t={(key) => key} inbox={null} accent="var(--module-north)" onScrub={vi.fn()} />);

    // "meridian.hint" only renders once `now` has landed (post-mount) AND
    // cursor is still null — i.e. still live, not seeded to any fixed replay
    // point. Mirrors the seeding test's wait for the same post-mount effect.
    await waitFor(() => {
      expect(screen.getByText("meridian.hint")).toBeTruthy();
    });
  });
});
