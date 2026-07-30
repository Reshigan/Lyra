import { describe, expect, it } from "vitest";

import { BrandJson, parseJson, toJson } from "./json";

/**
 * Regression: BrandJson.palette declared only { accent, accentHover }, so zod's
 * default strip-unknown-keys behaviour silently dropped accentContrast on every
 * write. The settings screen collects it, hex-validates it and enforces WCAG AA
 * on it before PATCHing; the shell maps it to --accent-contrast; the mobile theme
 * reads it. All three were consuming a field the schema could never persist.
 *
 * --accent-contrast is one of exactly five properties a tenant may override
 * (packages/ui/src/tokens.css), so this is a schema gap, not a client invention.
 */
describe("BrandJson.palette.accentContrast", () => {
  it("survives a write/read round trip", () => {
    const raw = toJson(BrandJson, {
      name: "GONXT",
      palette: { accent: "#5b8cff", accentHover: "#3f6fe0", accentContrast: "#070b14" }
    });

    expect(parseJson(BrandJson, raw).palette).toEqual({
      accent: "#5b8cff",
      accentHover: "#3f6fe0",
      accentContrast: "#070b14"
    });
  });

  it("stays optional, like its two siblings", () => {
    const palette = BrandJson.parse({ name: "GONXT", palette: { accent: "#5b8cff" } }).palette;

    expect(palette).toEqual({ accent: "#5b8cff" });
    expect("accentContrast" in palette).toBe(false);
  });
});
