import { describe, expect, it } from "vitest";
import { LABELS, nameOf, type StaffOption } from "./staff";

// The delegations table printed `usr_D9KE953TO2YKYY5RK6BEA6RI2YQY` under FROM
// for the one row whose user fell off the end of the picker's option list —
// at whoever is deciding whether to revoke that delegation.
describe("nameOf", () => {
  const options = [{ id: "us_01KE9", name: "Omar Farouk" }] as StaffOption[];

  it("says the name the picker already knows", () => {
    expect(nameOf(options, "us_01KE9")).toBe("Omar Farouk");
  });

  it("falls back to the directory for someone the picker never loaded", () => {
    expect(nameOf(options, "us_01KE8", { us_01KE8: "Nadia Rahman" })).toBe("Nadia Rahman");
  });

  it("shortens a ref nobody could name rather than printing the whole ULID", () => {
    expect(nameOf(options, "us_01KE953T02YKYY5RK6BEA6R2YQZ").length).toBeLessThan(
      "us_01KE953T02YKYY5RK6BEA6R2YQZ".length
    );
  });
});

describe("staff labels", () => {
  it("translates every English key into Arabic", () => {
    const missing = Object.keys(LABELS.en!).filter((key) => !(key in LABELS.ar!));
    expect(missing).toEqual([]);
  });
});
