import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Cell, measure, readable } from "./fields";
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

  // A conversation's external reference is the customer's own address on the
  // channel, not a ref this platform mints. Saying its scope as words rewrote
  // the number the agent searches for: `wa:971559876543` → "Wa 971559876543".
  it("leaves a channel address alone, colon and all", () => {
    expect(render("wa:971559876543")).toContain("wa:971559876543");
    expect(render("cms:aeo/excess-explained")).toContain("cms:aeo/excess-explained");
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

// The channels list headed a column DEFAULT COMMISSION and printed `400000`
// between two money columns, and KIND, MEDIUM and COLLECTS PAYMENT printed
// `b2c`, `call_centre` and `us` while the pack already had words for all three.
describe("Cell on a share and on an enum", () => {
  const cell = (
    spec: ColumnSpec,
    row: Record<string, unknown>,
    words: Record<string, string> = {}
  ) =>
    renderToStaticMarkup(
      <Cell column={spec} row={row} locale="en" label={(key) => words[key] ?? key} resolved={{}} />
    );

  it("reads parts per million as a percentage", () => {
    const markup = cell({ name: "defaultCommissionPpm", type: "rate" }, { defaultCommissionPpm: 400000 });
    expect(markup).toContain("40%");
    expect(markup).not.toContain("400000");
  });

  it("keeps a rate a multiplier, not a percentage", () => {
    const markup = cell({ name: "ratePpm", type: "ratio" }, { ratePpm: 18_500_000 });
    expect(markup).toContain("18.5");
    expect(markup).not.toContain("%");
  });

  it("says the words the pack has for an enum", () => {
    const markup = cell({ name: "medium", type: "text" }, { medium: "call_centre" }, {
      "medium.call_centre": "Call centre"
    });
    expect(markup).toContain("Call centre");
  });

  it("leaves a value the pack has no words for exactly as it is", () => {
    expect(cell({ name: "key", type: "text" }, { key: "direct-web" })).toContain("direct-web");
  });
});

// The NORTH snapshots list is one `value` column carrying four different kinds
// of number: it printed gross written premium in cents (`74300000`), an 88.1%
// response rate (`8810`) and a 3.62s latency (`3620`) with no unit on screen.
describe("measure", () => {
  it("reads money in its own currency", () => {
    expect(measure(74_300_000, "money", "ZAR", "en")).toContain("743,000");
  });

  it("reads basis points as a percentage", () => {
    expect(measure(8810, "percent", "", "en")).toBe("88.1%");
  });

  it("reads milliseconds as a duration", () => {
    expect(measure(3620, "duration_ms", "", "en")).toContain("3.62");
    expect(measure(450, "duration_ms", "", "en")).toContain("450");
  });

  it("reads a count as a grouped count", () => {
    expect(measure(4608, "count", "", "en")).toBe("4,608");
  });

  it("says nothing rather than NaN", () => {
    expect(measure(Number.NaN, "count", "", "en")).toBe("—");
  });
});
