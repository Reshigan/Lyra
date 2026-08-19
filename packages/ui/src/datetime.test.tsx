/**
 * A timestamp has to render the same characters on the server and on the first
 * client pass, or React 19 throws a hydration mismatch and the whole route
 * falls to the error boundary. A Worker runs in UTC and a reader does not, so
 * an unpinned `Intl.DateTimeFormat` guarantees that mismatch on every screen
 * carrying a date — which is all of them.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateTime } from "./format.js";

// 2026-08-11T05:07:58.339Z — the instant from the tour log that exposed this.
const INSTANT = 1786424878339;

describe("DateTime", () => {
  it("renders UTC regardless of the host's own zone", () => {
    // This process runs in whatever TZ the machine has; the markup may not.
    const markup = renderToStaticMarkup(<DateTime value={INSTANT} locale="en" />);
    expect(markup).toContain("05:07 AM");
  });

  it("still honours an explicit zone", () => {
    const markup = renderToStaticMarkup(
      <DateTime value={INSTANT} locale="en" timeZone="Asia/Riyadh" />
    );
    expect(markup).toContain("08:07 AM");
  });
});

/**
 * An instant no `Date` can hold reaches this component from stored data: the
 * API bounds every write surface now, but rows written before those bounds
 * landed are still in the tables. `Intl.DateTimeFormat.format` and
 * `toISOString` both throw `RangeError` on an Invalid Date, and a throw during
 * render takes the whole route to the error boundary — one bad cell, no page.
 */
describe("DateTime — values no Date can hold", () => {
  it("renders a dash instead of taking the route down", () => {
    const markup = renderToStaticMarkup(<DateTime value={9e15} locale="en" />);
    expect(markup).toContain("—");
  });

  it("survives NaN the same way", () => {
    const markup = renderToStaticMarkup(<DateTime value={Number.NaN} locale="en" />);
    expect(markup).toContain("—");
  });

  it("still renders a real instant", () => {
    const markup = renderToStaticMarkup(<DateTime value={INSTANT} locale="en" />);
    expect(markup).toContain("05:07 AM");
    expect(markup).not.toContain("—");
  });
});
