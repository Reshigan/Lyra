import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColdOpen, coldOpenAllowed } from "./cold-open";

// ADR-0055: the cold open is decoration that never holds the door. Three
// conditions gate it, and the two that can be decided without a browser are
// pure — so they are tested here rather than left to a screenshot.

describe("the cold open", () => {
  it("does not play for a reader who asked for less motion", () => {
    expect(coldOpenAllowed({ reduced: true, opened: false })).toBe(false);
    expect(coldOpenAllowed({ reduced: true, opened: true })).toBe(false);
  });

  it("plays once a sitting, not once a navigation", () => {
    expect(coldOpenAllowed({ reduced: false, opened: false })).toBe(true);
    expect(coldOpenAllowed({ reduced: false, opened: true })).toBe(false);
  });

  it("is absent from the server response, so nothing waits on it", () => {
    // It mounts in an effect, which the server never runs: the workspace is
    // painted and interactive before the overlay can exist at all.
    expect(renderToStaticMarkup(<ColdOpen name="Lyra" />)).toBe("");
  });
});
