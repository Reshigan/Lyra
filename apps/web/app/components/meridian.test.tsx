import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Meridian } from "./meridian";

// The initialAsOf-seeds-cursor behavior lives in a mount-only effect (see
// meridian.tsx), and renderToStaticMarkup never runs effects — so it cannot
// be observed here. This is NOT currently covered by any automated test. A
// future Playwright scenario could cover it by asserting the slider's
// aria-valuenow after navigating to a URL with ?asOf=<epoch-ms>, but the
// currently-planned e2e scenario for this feature does not do that.
describe("Meridian initialAsOf", () => {
  it("defaults to live (no cursor) when initialAsOf is absent", () => {
    const html = renderToStaticMarkup(
      <Meridian t={(key) => key} inbox={null} accent="var(--module-north)" onScrub={vi.fn()} />
    );
    // Without initialAsOf, cursor stays null, so at defaults to played (0 before mount)
    expect(html).toContain(`aria-valuenow="0"`);
  });
});
