import { describe, expect, it } from "vitest";
import { brandStyle } from "./shell";

// A tenant may re-map exactly five custom properties (packages/ui/src/tokens.css
// §TENANT OVERRIDE CONTRACT). `brand.font` is tenant-controlled data on its way
// into one of them, so the two things worth pinning are that an approved value
// arrives complete, and that an unapproved one arrives not at all.

const ARABIC_FALLBACK = '"IBM Plex Sans Arabic"';

describe("brandStyle typeface", () => {
  it("maps an approved font onto both roles, Arabic fallback intact", () => {
    const style = brandStyle({ font: "space-grotesk" }) as Record<string, string | undefined>;
    const expected = '"Space Grotesk", "IBM Plex Sans Arabic", system-ui, sans-serif';

    expect(style["--font-display"]).toBe(expected);
    expect(style["--font-ui"]).toBe(expected);
    // The whole point of a stack: RTL still has a face with Arabic coverage.
    expect(style["--font-display"]).toContain(ARABIC_FALLBACK);
  });

  it("leaves the default token in place for anything off the approved list", () => {
    // Two shapes of wrong: a plausible family name nobody approved, and CSS
    // that would close the declaration and open its own if it were interpolated.
    for (const font of ["comic-sans", "x; } body { display: none } .a {", "__proto__", "constructor"]) {
      const style = brandStyle({ font }) as Record<string, string | undefined>;
      expect(style["--font-display"], font).toBeUndefined();
      expect(style["--font-ui"], font).toBeUndefined();
      expect(JSON.stringify(style), font).not.toContain("display: none");
    }
  });

  it("still maps the three colour tokens, and only those", () => {
    const style = brandStyle({
      palette: { accent: "#ffb020", accentHover: "#d98e0b", accentContrast: "#412402" }
    }) as Record<string, string | undefined>;

    expect(Object.keys(style).sort()).toEqual(["--accent", "--accent-contrast", "--accent-hover"]);
  });
});
