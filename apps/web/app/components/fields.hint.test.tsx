import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldInput } from "./fields";
import { labelsFrom } from "../routes/detail-kit";
import type { FieldSpec } from "../modules/spec";

// Three field types are typed in units nothing on the screen states: `json`
// wants a literal document, and `rate`/`ratio` are both stored as parts per
// million but typed as a percentage and a multiplier respectively. Across the
// workspaces 434 spec fields carry 13 hints between them, so the explanation
// had to attach to the type rather than to each field.
//
// What this holds: the hint reaches the input in both languages, a field's own
// `hintKey` still wins, and the types that need no hint get none. The label
// resolver here is the real one, not a stub — the whole point is that the keys
// live in the shared catalogue and every workspace falls through to it.

const l = (locale: string) => labelsFrom({})(locale);

const render = (field: FieldSpec, locale = "en") =>
  renderToStaticMarkup(<FieldInput field={field} label={l(locale)} />);

describe("type hints on a spec field", () => {
  it("tells a person what a json field takes", () => {
    expect(render({ name: "scopeJson", type: "json" })).toContain("JSON");
  });

  it("says a rate is a percentage and a ratio is not", () => {
    expect(render({ name: "commissionPpm", type: "rate" })).toContain("percent");
    expect(render({ name: "fxPpm", type: "ratio" })).toContain("not a percentage");
  });

  it("says it in Arabic too", () => {
    const html = render({ name: "scopeJson", type: "json" }, "ar");
    expect(html).toContain("كائن");
    // The key itself never reaches a reader in either language.
    expect(html).not.toContain("field.hint.json");
  });

  it("lets a field's own hintKey win", () => {
    const html = renderToStaticMarkup(
      <FieldInput
        field={{ name: "scopeJson", type: "json", hintKey: "mine" }}
        label={(key) => (key === "mine" ? "Which tenants this key may read." : key)}
      />
    );
    expect(html).toContain("Which tenants this key may read.");
    expect(html).not.toContain("JSON —");
  });

  it("leaves the types whose label already says it alone", () => {
    // `money` submits raw minor units and every such field is named `…Minor`.
    expect(render({ name: "premiumMinor", type: "money" })).not.toContain("hint");
    expect(render({ name: "name", type: "text" })).not.toContain("hint");
  });
});
