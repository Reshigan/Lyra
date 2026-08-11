import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../api.server";
import { whoIs } from "./conversation";

// The facts panel printed `us_01KE…` for the agent holding the thread and
// `tm_01KE…` for their team, while the directory the same loader had already
// fetched held both names.

const DIRECTORY: DirectoryEntry[] = [
  { ref: "user:us_01KE953T000WTENZD6WY9TPYA0", name: "Amina Haddad" },
  { ref: "team:tm_01KE953T000WTENZD6WY9TPYA1", name: "Retentions" }
];

describe("whoIs", () => {
  it("names an assignee from the ref the field submits", () => {
    expect(whoIs(DIRECTORY, "user:us_01KE953T000WTENZD6WY9TPYA0")).toBe("Amina Haddad");
  });

  it("names a team stored bare, without the kind prefix", () => {
    expect(whoIs(DIRECTORY, "tm_01KE953T000WTENZD6WY9TPYA1")).toBe("Retentions");
  });

  it("leaves an unlisted ref to the caller, which shows the ref itself", () => {
    expect(whoIs(DIRECTORY, "us_01KE953T000WTENZD6WY9TPYA9")).toBeNull();
  });

  it("has nothing to say about an unassigned thread", () => {
    expect(whoIs(DIRECTORY, null)).toBeNull();
  });
});
