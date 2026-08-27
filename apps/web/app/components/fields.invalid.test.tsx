import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldInput } from "./fields";
import { rejectedBy } from "../api-error";
import type { FieldSpec } from "../modules/spec";

// The API has always named the fields it rejected — `problem.errors`, keyed by
// the zod path joined with dots, which is the same string the form posts as
// `name`. Nothing read it, so a rejected create said only that something was
// wrong. This is the seam that makes the marking automatic: every spec-driven
// form renders its inputs through FieldInput, and FieldInput already holds the
// key. The lookup is by `field.name`, so a test that mismatches the two is what
// this guards.

const field: FieldSpec = { name: "companyName", type: "text" };
const label = (key: string) => key;

const render = (invalid?: (name: string) => string | undefined) =>
  renderToStaticMarkup(<FieldInput field={field} label={label} {...(invalid ? { invalid } : {})} />);

describe("FieldInput marking a rejected input", () => {
  it("shows the caller's wording for a field the API named", () => {
    const problem = { title: "invalid", status: 400, errors: { companyName: "String must contain at least 2 character(s)" } };
    expect(render(rejectedBy(problem, () => "This needs correcting."))).toContain("This needs correcting.");
  });

  it("does not show zod's own English, which is untranslatable", () => {
    const problem = { title: "invalid", status: 400, errors: { companyName: "String must contain at least 2 character(s)" } };
    expect(render(rejectedBy(problem, () => "This needs correcting."))).not.toContain("at least 2 character");
  });

  it("leaves a field the API did not name unmarked", () => {
    const problem = { title: "invalid", status: 400, errors: { taxId: "Required" } };
    expect(render(rejectedBy(problem, () => "This needs correcting."))).not.toContain("This needs correcting.");
  });

  it("marks nothing when there is no problem at all", () => {
    expect(render(rejectedBy(null, () => "This needs correcting."))).not.toContain("This needs correcting.");
  });
});
