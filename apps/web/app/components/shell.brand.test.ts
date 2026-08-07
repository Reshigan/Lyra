import { describe, expect, it } from "vitest";
import { brandStyle, lockupNames } from "./shell";

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

// The Horizon lockup shows the product mark next to the tenant it is serving —
// two names, a divider between them. Most tenants never set a brand name, and
// "Sahab Cover | Sahab Cover" is worse than one word, so the second slot is
// earned, not reserved.

describe("lockupNames", () => {
  it("shows the tenant beside the brand when the brand renamed the product", () => {
    expect(lockupNames({ name: "Nova" }, "Sahab Cover")).toEqual({ product: "Nova", tenant: "Sahab Cover" });
  });

  it("falls back to the tenant as the product when no brand name is set", () => {
    expect(lockupNames(null, "Sahab Cover")).toEqual({ product: "Sahab Cover", tenant: null });
    expect(lockupNames({}, "Sahab Cover")).toEqual({ product: "Sahab Cover", tenant: null });
  });

  it("does not print the same name twice", () => {
    expect(lockupNames({ name: "Sahab Cover" }, "Sahab Cover")).toEqual({
      product: "Sahab Cover",
      tenant: null
    });
    // Whitespace and case are presentation, not identity.
    expect(lockupNames({ name: " sahab cover " }, "Sahab Cover").tenant).toBeNull();
  });
});
