import { describe, expect, it } from "vitest";
import { refFor, type RefOption } from "./ref-picker";

// The screening form asked for the customer as a raw `cu_01KE…`, so the only
// way to run one was to leave and copy an id out of another list.

const OPTIONS: RefOption[] = [
  { id: "cu_01KE953T000WTENZD6WY9TPYA0", label: "Amina Haddad" },
  { id: "cu_01KE953T000WTENZD6WY9TPYA1", label: "Gulf Marine Logistics" }
];

describe("refFor", () => {
  it("posts the id behind the name a person picked", () => {
    expect(refFor("Amina Haddad", OPTIONS)).toBe("cu_01KE953T000WTENZD6WY9TPYA0");
  });

  it("ignores the case and the spaces a datalist pick can leave behind", () => {
    expect(refFor("  gulf marine logistics ", OPTIONS)).toBe("cu_01KE953T000WTENZD6WY9TPYA1");
  });

  it("keeps a pasted ref, so the box still works for someone who has one", () => {
    expect(refFor("cu_01KE953T000WTENZD6WY9TPYA9", OPTIONS)).toBe("cu_01KE953T000WTENZD6WY9TPYA9");
  });

  it("posts nothing at all when the box is empty", () => {
    expect(refFor("   ", OPTIONS)).toBe("");
  });

  it("leaves an unknown name to the server rather than guessing a customer", () => {
    expect(refFor("Someone else", OPTIONS)).toBe("Someone else");
  });

  it("still yields the typed text when the actor cannot read the list", () => {
    expect(refFor("cu_01KE953T000WTENZD6WY9TPYA0", [])).toBe("cu_01KE953T000WTENZD6WY9TPYA0");
  });
});
