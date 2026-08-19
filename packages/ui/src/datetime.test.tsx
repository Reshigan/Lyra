/**
 * A timestamp has to render the same characters on the server and on the first
 * client pass, or React 19 throws a hydration mismatch and the whole route
 * falls to the error boundary. A Worker runs in UTC and a reader does not, so
 * an unpinned `Intl.DateTimeFormat` guarantees that mismatch on every screen
 * carrying a date — which is all of them.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateTime, formatInstant } from "./format.js";

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

  // NoData's precedent (format.tsx): a dash is punctuation, not content. Read
  // aloud as content it is "dash" or silence, with nothing saying a date was
  // expected — and this package carries no copy of its own to say it with, so
  // the dash is hidden and whatever the caller labelled the element with is
  // what remains (CLAUDE.md §8).
  it("hides the dash from assistive tech the way an empty cell does", () => {
    const markup = renderToStaticMarkup(<DateTime value={9e15} locale="en" />);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("keeps a caller's own label on the degraded element", () => {
    const markup = renderToStaticMarkup(
      <DateTime value={9e15} locale="en" aria-label="cover ends" />
    );
    expect(markup).toContain('aria-label="cover ends"');
  });
});

/**
 * The same guard for the renderers that cannot be this component: a lede
 * sentence and a form's input value need a string, and three portal screens
 * pass `Intl` options `formatDate` does not carry. They shared nothing before,
 * so `Intl.format(new Date(9e15))` threw `RangeError` mid-render on five
 * screens the `<DateTime>` guard never touches.
 */
describe("formatInstant", () => {
  it("degrades to the same dash rather than throwing", () => {
    const fmt = new Intl.DateTimeFormat("en", { dateStyle: "long" });
    expect(formatInstant(9e15, (d) => fmt.format(d))).toBe("—");
    expect(formatInstant(Number.NaN, (d) => d.toISOString())).toBe("—");
  });

  it("formats an instant a Date can hold", () => {
    expect(formatInstant(INSTANT, (d) => d.toISOString())).toBe("2026-08-11T05:07:58.339Z");
  });

  it("never calls the renderer with an unusable Date", () => {
    let seen: number | null = null;
    formatInstant(9e15, (d) => {
      seen = d.getTime();
      return "";
    });
    expect(seen).toBeNull();
  });
});
