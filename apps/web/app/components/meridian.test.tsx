import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Meridian } from "./meridian";

describe("Meridian initialAsOf", () => {
  it("seeds the scrubber cursor from initialAsOf when provided", () => {
    const asOf = 0.5; // noon (halfway through the day)
    const html = renderToStaticMarkup(
      <Meridian
        t={(key) => key}
        inbox={null}
        accent="var(--module-north)"
        initialAsOf={asOf}
        onScrub={vi.fn()}
      />
    );
    // The slider's aria-valuenow should reflect the initial cursor position
    const expectedValue = Math.round(asOf * 1440); // 720 for noon
    expect(html).toContain(`aria-valuenow="${expectedValue}"`);
  });

  it("defaults to live (no cursor) when initialAsOf is absent", () => {
    const html = renderToStaticMarkup(
      <Meridian t={(key) => key} inbox={null} accent="var(--module-north)" onScrub={vi.fn()} />
    );
    // Without initialAsOf, cursor stays null, so at defaults to played (0 before mount)
    expect(html).toContain(`aria-valuenow="0"`);
  });
});
