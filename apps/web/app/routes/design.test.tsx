import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Doctrine, PALETTE } from "./design";

// The doctrine page is the design system explaining itself: the four rules the
// rest of the platform is built to, the palette and the three type voices. Its
// one hard requirement is that it stays true — a swatch that prints a hex
// copied by hand is a lie the moment a token moves.

describe("the doctrine page", () => {
  it("reads its swatches from the tokens rather than repeating them", () => {
    const markup = renderToStaticMarkup(<Doctrine locale="en" />);
    expect(PALETTE.length).toBeGreaterThan(0);
    for (const swatch of PALETTE) expect(markup).toContain(`var(${swatch.token})`);
    // No literal colour anywhere: the page never states a value it cannot
    // re-read, so a re-themed tenant sees its own palette, not ours.
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("names all four rules and all three voices", () => {
    const markup = renderToStaticMarkup(<Doctrine locale="en" />);
    for (const n of ["01", "02", "03", "04"]) expect(markup).toContain(n);
    for (const family of ["font-serif", "font-display", "font-mono"]) {
      expect(markup).toContain(family);
    }
  });

  it("is written in both languages", () => {
    const english = renderToStaticMarkup(<Doctrine locale="en" />);
    const arabic = renderToStaticMarkup(<Doctrine locale="ar" />);
    expect(english).toContain("Software that takes the shape of the person using it.");
    expect(arabic).not.toContain("Software that takes the shape of the person using it.");
    // Token names are identifiers, not copy: they read the same in both.
    for (const swatch of PALETTE) expect(arabic).toContain(`var(${swatch.token})`);
  });
});
