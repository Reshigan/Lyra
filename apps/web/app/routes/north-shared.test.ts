import { describe, expect, it } from "vitest";
import { metricName, num, parsed, pct } from "./north-shared";

// The generic CRUD hydrates every `*Json` column before it leaves the API
// (apps/api/src/crud.ts), while a bespoke module route hands the raw text
// through. Both shapes reach these screens, so both are pinned here.

describe("parsed", () => {
  it("takes an already-hydrated object as it is", () => {
    expect(parsed<{ a: number }>({ a: 1 }, { a: 0 })).toEqual({ a: 1 });
    expect(parsed<number[]>([1, 2], [])).toEqual([1, 2]);
  });

  it("still parses the raw text a module route hands through", () => {
    expect(parsed<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it("falls back rather than taking the screen down on a malformed column", () => {
    expect(parsed<string[]>("{not json", [])).toEqual([]);
  });

  it("treats empty, null and absent as nothing recorded", () => {
    expect(parsed("", "fallback")).toBe("fallback");
    expect(parsed(null, "fallback")).toBe("fallback");
    expect(parsed(undefined, "fallback")).toBe("fallback");
  });
});

describe("metricName", () => {
  const names = { en: "Gross written premium", ar: "إجمالي الأقساط المكتتبة" };

  it("reads the actor's locale out of a hydrated name column", () => {
    expect(metricName({ key: "gwp", nameJson: names }, "ar")).toBe(names.ar);
  });

  it("reads it out of the raw text just the same", () => {
    expect(metricName({ key: "gwp", nameJson: JSON.stringify(names) }, "en")).toBe(names.en);
  });

  it("falls back to English before it falls back to the key", () => {
    expect(metricName({ key: "gwp", nameJson: { en: names.en } }, "ar")).toBe(names.en);
    expect(metricName({ key: "gwp", nameJson: null }, "en")).toBe("gwp");
  });
});

describe("num", () => {
  it("renders an em dash where the detector recorded nothing", () => {
    expect(num(null, "en")).toBe("—");
    expect(num(undefined, "en")).toBe("—");
  });

  it("keeps zero, which is a number and not an absence", () => {
    expect(num(0, "en")).toBe("0");
  });
});

describe("pct", () => {
  it("signs a move so a rise reads as a rise", () => {
    expect(pct(1200, "en")).toBe("+12%");
    expect(pct(-1200, "en")).toBe("-12%");
  });

  it("has nothing to say without a prior", () => {
    expect(pct(null, "en")).toBeNull();
  });
});
