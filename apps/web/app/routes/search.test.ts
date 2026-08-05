import { describe, expect, it } from "vitest";
import { hitToItem } from "./search";

// /v1/search returns whole rows from whichever resources the caller may read, so
// the palette has to name a row it has never seen the shape of, and link to it
// without knowing which module owns it.

describe("search hit to palette item", () => {
  it("names a row by the first human field it carries", () => {
    const hit = { resource: "leads", module: "axis", row: { id: "led_1", name: "Nadia Haddad" } };
    expect(hitToItem(hit)).toEqual({
      id: "led_1",
      label: "Nadia Haddad",
      hint: "leads",
      href: "/axis/leads/led_1"
    });
  });

  it("falls back through the other naming fields before the id", () => {
    expect(hitToItem({ resource: "t", module: "m", row: { id: "1", reference: "REF-9" } })?.label).toBe("REF-9");
    expect(hitToItem({ resource: "t", module: "m", row: { id: "1", subject: "Renewal" } })?.label).toBe("Renewal");
    expect(hitToItem({ resource: "t", module: "m", row: { id: "1", status: "open" } })?.label).toBe("1");
    // A blank name is not a name.
    expect(hitToItem({ resource: "t", module: "m", row: { id: "1", name: "  " } })?.label).toBe("1");
  });

  it("drops a hit with no id, because there is nothing to open", () => {
    expect(hitToItem({ resource: "t", module: "m", row: { name: "orphan" } })).toBeNull();
  });
});
