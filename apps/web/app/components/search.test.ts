import { describe, expect, it } from "vitest";
import { matchingDestinations } from "./search";

// The palette runs its own filter over nav destinations: CommandBar's local one
// is off (onQueryChange is set), because the record rows beside them are matched
// by the server on fields no label shows.

const NAV = [
  { href: "/axis", label: "Operations" },
  { href: "/orbit", label: "Service" },
  { href: "/admin/customers", label: "Customers" }
];

describe("matchingDestinations", () => {
  it("offers every destination before anything is typed", () => {
    expect(matchingDestinations(NAV, "").map((d) => d.href)).toEqual([
      "/axis",
      "/orbit",
      "/admin/customers"
    ]);
    expect(matchingDestinations(NAV, "   ")).toHaveLength(3);
  });

  it("matches the label regardless of case", () => {
    expect(matchingDestinations(NAV, "cust").map((d) => d.href)).toEqual(["/admin/customers"]);
    expect(matchingDestinations(NAV, "SERV").map((d) => d.href)).toEqual(["/orbit"]);
  });

  it("returns nothing rather than everything when the query matches no workspace", () => {
    expect(matchingDestinations(NAV, "policy 42")).toEqual([]);
  });
});
