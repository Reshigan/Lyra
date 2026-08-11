import { describe, expect, it } from "vitest";
import { chosenLocale, langFor, localeFrom, moduleName, pseudoText, translator } from "./i18n";
import { labelsIn } from "./routes/search-results";

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

  it("leaves real locales alone", () => {
    expect(pseudoText("en", "Search results")).toBe("Search results");
    expect(pseudoText("ar", "نتائج البحث")).toBe("نتائج البحث");
  });

  it("wraps route-local copy, which no catalogue and so no translator sees", () => {
    expect(pseudoText("pseudo", "Search results")).toMatch(/^⟦.*⟧$/);
  });

  it("reaches a route's own label table, or the detector is blind to it", () => {
    // A route table that fell through to English would be indistinguishable
    // from a hardcoded JSX literal — which is the one thing this locale exists
    // to catch. Placeholders stay intact so the label still interpolates.
    const l = labelsIn("pseudo");
    expect(l("title")).toMatch(/^⟦.*⟧$/);
    expect(l("count", { count: "3", areas: "2" })).toContain("3");
  });
});

// Cost explorer headed a column MODULE and listed the rollup's storage keys
// under it: "dist", "orbit", "core".
describe("moduleName", () => {
  it("gives the name the nav puts on the rail", () => {
    expect(moduleName(translator("en"), "orbit")).toBe("Conversations");
    expect(moduleName(translator("ar"), "orbit")).toBe("المحادثات");
  });

  it("maps the keys the nav spells differently, or has no rail entry for", () => {
    expect(moduleName(translator("en"), "dist")).toBe("Distribution");
    expect(moduleName(translator("en"), "core")).toBe("Shared services");
  });

  it("title-cases a module nobody has named yet rather than printing nav.x", () => {
    expect(moduleName(translator("en"), "atlas")).toBe("Atlas");
  });
});
