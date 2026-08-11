import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageSkeleton } from "./shell";

// Navigation is server-loaded, so a slow screen used to be a page that simply
// did not change: the actor clicked, nothing moved, and the only signal was the
// browser's own tab spinner. Past 400ms the shell draws the arriving screen's
// shape instead (docs/07 latency doctrine, docs/ui.md §7.5).

describe("the pending-navigation skeleton", () => {
  it("pulses and says it is loading, once, for a screen reader", () => {
    // The word comes from the catalogue on the real screen; the test passes a
    // marker so the no-hard-coded-English scan has nothing to flag here.
    const word = "common.loading";
    const markup = renderToStaticMarkup(<PageSkeleton label={word} />);
    expect(markup).toContain("animate-pulse");
    expect(markup).toContain('aria-busy="true"');
    // The bars themselves are decorative — the word carries the wait.
    expect(markup.match(new RegExp(word, "g"))).toHaveLength(1);
  });
});
