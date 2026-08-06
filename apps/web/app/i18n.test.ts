import { describe, expect, it } from "vitest";
import { chosenLocale, langFor, localeFrom, translator } from "./i18n";

const request = (headers: Record<string, string>) => new Request("https://lyra.test/", { headers });

describe("chosenLocale", () => {
  // The document's lang/dir (root.tsx) and the shell's strings (routes/workspace)
  // have to read the same locale, or a language switch renders an Arabic
  // document full of English. This helper is that shared source: what the user
  // explicitly picked, or nothing.
  it("is the cookie when it names a catalogue", () => {
    expect(chosenLocale(request({ cookie: "lyra_locale=ar" }))).toBe("ar");
  });

  it("is the pseudo locale, which has no catalogue of its own", () => {
    expect(chosenLocale(request({ cookie: "lyra_locale=pseudo" }))).toBe("pseudo");
  });

  it("is nothing when the cookie is absent or names a language we do not have", () => {
    expect(chosenLocale(request({}))).toBeUndefined();
    expect(chosenLocale(request({ cookie: "lyra_locale=tlh" }))).toBeUndefined();
  });
});

describe("localeFrom", () => {
  it("prefers the explicit choice over the browser's list", () => {
    expect(localeFrom(request({ cookie: "lyra_locale=ar", "accept-language": "en-GB,en" }))).toBe("ar");
  });

  it("falls back to Accept-Language, then English", () => {
    expect(localeFrom(request({ "accept-language": "ar-SA,ar;q=0.9" }))).toBe("ar");
    expect(localeFrom(request({ "accept-language": "fr-FR" }))).toBe("en");
  });
});

describe("pseudo locale", () => {
  it("wraps every string so an untranslated one is visible on sight", () => {
    expect(translator("pseudo")("app.skipToContent")).toMatch(/^⟦.*⟧$/);
    expect(langFor("pseudo")).toBe("en-x-pseudo");
  });
});
