import { describe, expect, it } from "vitest";
import { CALENDARS, FALLBACK_CURRENCY, calendarFrom, timezoneFrom, zones } from "./calendar";

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

describe("timezoneFrom", () => {
  it("passes through a zone this runtime can format in", () => {
    expect(timezoneFrom("Asia/Dubai")).toBe("Asia/Dubai");
    expect(timezoneFrom("Africa/Johannesburg")).toBe("Africa/Johannesburg");
    expect(timezoneFrom("UTC")).toBe("UTC");
  });

  // The whole reason this function exists rather than a cast: a zone Intl does
  // not know throws a RangeError from inside formatToParts, which happens
  // during render and takes the route to the error boundary. Tenant policy is
  // editable text, so an unknown value has to degrade, not throw.
  it("degrades an unreadable zone to undefined rather than throwing", () => {
    expect(timezoneFrom("Mars/Olympus_Mons")).toBeUndefined();
    expect(timezoneFrom("Asia/Dubai ")).toBeUndefined();
    expect(() => new Intl.DateTimeFormat("en", { timeZone: "Mars/Olympus_Mons" })).toThrow();
  });

  it("treats a missing or non-string policy value as no configured zone", () => {
    expect(timezoneFrom(undefined)).toBeUndefined();
    expect(timezoneFrom(null)).toBeUndefined();
    expect(timezoneFrom("")).toBeUndefined();
    expect(timezoneFrom(0)).toBeUndefined();
    expect(timezoneFrom({ timeZone: "Asia/Dubai" })).toBeUndefined();
  });
});

describe("zones", () => {
  it("offers the zones this runtime can actually format in", () => {
    const all = zones();
    expect(all.length).toBeGreaterThan(100);
    expect(all).toContain("Asia/Dubai");
    expect(all).toContain("Africa/Johannesburg");
    expect(all.every((zone) => timezoneFrom(zone) === zone)).toBe(true);
  });

  it("keeps a zone the runtime has dropped selectable, so saving cannot clear it", () => {
    expect(zones("Factory/Legacy")[0]).toBe("Factory/Legacy");
    // Already present: offered once, not twice.
    expect(zones("Asia/Dubai").filter((zone) => zone === "Asia/Dubai")).toHaveLength(1);
  });
});
