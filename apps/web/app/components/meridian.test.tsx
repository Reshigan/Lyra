import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Meridian } from "./meridian";

// The initialAsOf-seeds-cursor behavior lives in a mount-only effect (see
// meridian.tsx), and renderToStaticMarkup never runs effects — so it cannot
// be observed here. That case is covered instead by the Playwright e2e
// suite (apps/web/e2e/north-shell.spec.ts), which can exercise a real mount.
describe("Meridian initialAsOf", () => {
  it("defaults to live (no cursor) when initialAsOf is absent", () => {
    const html = renderToStaticMarkup(
      <Meridian t={(key) => key} inbox={null} accent="var(--module-north)" onScrub={vi.fn()} />
    );
    // Without initialAsOf, cursor stays null, so at defaults to played (0 before mount)
    expect(html).toContain(`aria-valuenow="0"`);
  });
});
