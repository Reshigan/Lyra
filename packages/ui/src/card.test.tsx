/**
 * Every screen that renders a card body conditionally — the quote desk's case
 * card with no bids yet, a list card with nothing in it — drew an empty padded
 * band under its header, which reads as a screen that failed to finish loading.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "./primitives.js";

describe("Card", () => {
  it("draws no body when there is nothing in it", () => {
    const markup = renderToStaticMarkup(<Card title="Case" description="No provider has priced this yet">{null}</Card>);
    expect(markup).not.toContain('class="p-4"');
  });

  it("still draws the body when there is something in it", () => {
    const markup = renderToStaticMarkup(<Card title="Case"><p>one bid</p></Card>);
    expect(markup).toContain('class="p-4"');
    expect(markup).toContain("one bid");
  });
});
