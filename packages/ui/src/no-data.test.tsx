/**
 * The audience-value table printed "Not enough data yet" as a sentence in every
 * empty cell — five columns of it — which wrapped four lines deep and buried the
 * numbers that existed.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoData } from "./format.js";

describe("NoData", () => {
  it("shows a dash and keeps the reason readable", () => {
    const markup = renderToStaticMarkup(<NoData reason="Not enough data yet" />);
    expect(markup).toContain("—");
    expect(markup).toContain('title="Not enough data yet"');
    expect(markup).toContain("sr-only");
  });
});
