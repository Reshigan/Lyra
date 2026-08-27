import { describe, expect, it } from "vitest";
import { invalidFields } from "./api-error";

// apps/api/src/http.ts:33 keys `problem.errors` by the zod path joined with
// dots — the same string the form posts as `name` — and uses `_` for an issue
// with no path at all. That mapping is the whole contract this helper rests on.

describe("invalidFields", () => {
  it("names the fields a validation 400 rejected", () => {
    const fields = invalidFields({
      title: "Bad request",
      status: 400,
      errors: { email: "Invalid email", companyName: "String must contain at least 2 character(s)" }
    });
    expect([...fields].sort()).toEqual(["companyName", "email"]);
  });

  it("drops the whole-body issue, which names no input to mark", () => {
    expect([...invalidFields({ title: "Bad request", status: 400, errors: { _: "Expected object" } })]).toEqual([]);
  });

  it("stays empty for a failure that is not field-level", () => {
    expect(invalidFields({ title: "Forbidden", status: 403, errors: { email: "no" } }).size).toBe(0);
    expect(invalidFields({ title: "Bad request", status: 400 }).size).toBe(0);
    expect(invalidFields(null).size).toBe(0);
  });
});
