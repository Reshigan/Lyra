import { describe, expect, it } from "vitest";
import { CALENDARS, FALLBACK_CURRENCY, calendarFrom } from "./session.server";

describe("calendarFrom", () => {
  it("passes through a known calendar preference", () => {
    expect(calendarFrom("islamic-umalqura")).toBe("islamic-umalqura");
    expect(calendarFrom("dual")).toBe("dual");
  });

  it("falls back to gregorian for anything unrecognized", () => {
    expect(calendarFrom("solar")).toBe("gregorian");
    expect(calendarFrom(undefined)).toBe("gregorian");
    expect(calendarFrom(null)).toBe("gregorian");
  });
});

describe("CALENDARS / FALLBACK_CURRENCY", () => {
  it("exposes the three supported calendar preferences", () => {
    expect(CALENDARS).toEqual(["gregorian", "islamic-umalqura", "dual"]);
  });

  it("exposes AED as the fallback currency", () => {
    expect(FALLBACK_CURRENCY).toBe("AED");
  });
});
