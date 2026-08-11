import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Cell, readable } from "./fields";
import type { ColumnSpec } from "../modules/spec";

// Every generic list and record page renders through Cell, and every one of
// them printed raw ids: the cases list headed a column OWNER and showed
// `user:us_01KE953T022YFKRM6K7AQQ2FMN`. The loader batches those refs through
// /v1/names; this is what Cell does with the answer.

const column: ColumnSpec = { name: "ownerRef", type: "text" };
const label = (key: string) => key;
const render = (value: string, resolved: Record<string, string> = {}) =>
  renderToStaticMarkup(
    <Cell column={column} row={{ ownerRef: value }} locale="en" label={label} resolved={resolved} />
  );

describe("Cell on a ref-shaped value", () => {
  it("shows the name when the batch resolved it", () => {
    const ref = "user:us_01KE953T022YFKRM6K7AQQ2FMN";
    expect(render(ref, { [ref]: "Omar Farouk" })).toContain("Omar Farouk");
  });

  it("shortens it when the batch did not", () => {
    const markup = render("user:us_01KE953T022YFKRM6K7AQQ2FMN");
    expect(markup).not.toContain("01KE953T022YFKRM6K7AQQ2FMN");
    expect(markup).toContain("…");
  });

  it("leaves anything that is not a ref alone", () => {
    expect(render("GNX-2601-0001")).toContain("GNX-2601-0001");
  });
});

// The customers list headed a column NAME and printed `{"en":"E2E Visitor"}`
// down the whole page, and TAGS `["portal-lead"]`.
describe("readable", () => {
  it("reads a localised name in the actor's locale, falling back to English", () => {
    const name = { en: "Rania Haddad", ar: "رانيا حداد" };
    expect(readable(name, "ar")).toBe("رانيا حداد");
    expect(readable(name, "fr")).toBe("Rania Haddad");
  });

  it("reads a JSON string the API sent as text", () => {
    expect(readable('{"en":"E2E Visitor"}', "en")).toBe("E2E Visitor");
  });

  it("reads a list as a list", () => {
    expect(readable('["portal-lead","vip"]', "en")).toBe("portal-lead, vip");
  });

  it("names the flags that are set and drops the ones that are not", () => {
    expect(readable({ pep: true, sanctions: false }, "en")).toBe("Pep");
  });

  it("comes back empty for nothing, so the caller renders its own em dash", () => {
    expect(readable([], "en")).toBe("");
    expect(readable(null, "en")).toBe("");
  });
});
