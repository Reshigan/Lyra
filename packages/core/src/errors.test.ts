import { describe, expect, it } from "vitest";
import {
  AppError,
  approvalRequired,
  badRequest,
  conflict,
  consentRequired,
  forbidden,
  gone,
  internal,
  mfaRequired,
  notEntitled,
  notFound,
  tooManyRequests,
  toProblem,
  unauthorized,
  unprocessable
} from "./errors.js";

describe("AppError", () => {
  it("carries status, code, message, detail and extras as given to the constructor", () => {
    const err = new AppError(418, "teapot", "I'm a teapot", "brewing", { pot: "clay" });
    expect(err.name).toBe("AppError");
    expect(err.status).toBe(418);
    expect(err.code).toBe("teapot");
    expect(err.message).toBe("I'm a teapot");
    expect(err.detail).toBe("brewing");
    expect(err.extras).toEqual({ pot: "clay" });
  });

  it("defaults detail to undefined and extras to {} when omitted", () => {
    const err = new AppError(500, "internal", "Something went wrong");
    expect(err.detail).toBeUndefined();
    expect(err.extras).toEqual({});
  });

  describe("toProblem", () => {
    it("builds the RFC 9457 shape with type derived from the code", () => {
      const err = new AppError(404, "not_found", "Not found", "widget");
      expect(err.toProblem()).toEqual({
        type: "https://lyra.app/problems/not_found",
        title: "Not found",
        status: 404,
        code: "not_found",
        detail: "widget"
      });
    });

    it("omits detail when undefined", () => {
      const err = new AppError(500, "internal", "Something went wrong");
      const problem = err.toProblem();
      expect("detail" in problem).toBe(false);
      expect(problem).toEqual({
        type: "https://lyra.app/problems/internal",
        title: "Something went wrong",
        status: 500,
        code: "internal"
      });
    });

    it("includes instance only when passed", () => {
      const err = new AppError(409, "conflict", "Conflict");
      expect("instance" in err.toProblem()).toBe(false);
      expect(err.toProblem("req_1")).toMatchObject({ instance: "req_1" });
    });

    it("spreads extras onto the problem body", () => {
      const err = new AppError(429, "rate_limited", "Too many requests", undefined, { retry_after: 30 });
      expect(err.toProblem()).toEqual({
        type: "https://lyra.app/problems/rate_limited",
        title: "Too many requests",
        status: 429,
        code: "rate_limited",
        retry_after: 30
      });
    });
  });
});

describe("factory functions", () => {
  it("badRequest: 400, optional detail, errors only when given", () => {
    const bare = badRequest("bad shape");
    expect(bare).toMatchObject({ status: 400, code: "bad_request", message: "Bad request", detail: "bad shape" });
    expect(bare.extras).toEqual({});

    const withErrors = badRequest("bad shape", { "customer.email": "invalid" });
    expect(withErrors.extras).toEqual({ errors: { "customer.email": "invalid" } });
  });

  it("unauthorized: 401", () => {
    const err = unauthorized("no session");
    expect(err).toMatchObject({ status: 401, code: "unauthorized", message: "Authentication required", detail: "no session" });
  });

  it("forbidden: 403, records the missing permission only when given", () => {
    const bare = forbidden();
    expect(bare).toMatchObject({ status: 403, code: "forbidden", message: "Not permitted", detail: undefined });
    expect(bare.extras).toEqual({});

    const withPerm = forbidden("axis:cases:approve");
    expect(withPerm.detail).toBe("axis:cases:approve");
    expect(withPerm.extras).toEqual({ permission: "axis:cases:approve" });
  });

  it("notFound: 404, defaults resource to 'resource'", () => {
    expect(notFound()).toMatchObject({ status: 404, code: "not_found", message: "Not found", detail: "resource" });
    expect(notFound("approval")).toMatchObject({ detail: "approval" });
  });

  it("conflict: 409", () => {
    expect(conflict("already approved")).toMatchObject({ status: 409, code: "conflict", message: "Conflict", detail: "already approved" });
  });

  it("gone: 410", () => {
    expect(gone("expired")).toMatchObject({ status: 410, code: "gone", message: "No longer available", detail: "expired" });
  });

  it("unprocessable: 422, errors only when given", () => {
    const bare = unprocessable("bad state");
    expect(bare.extras).toEqual({});
    const withErrors = unprocessable("bad state", { amount: "negative" });
    expect(withErrors.extras).toEqual({ errors: { amount: "negative" } });
    expect(withErrors).toMatchObject({ status: 422, code: "unprocessable", message: "Cannot process" });
  });

  it("tooManyRequests: 429, no detail, retry_after in extras", () => {
    const err = tooManyRequests(30);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", message: "Too many requests", detail: undefined });
    expect(err.extras).toEqual({ retry_after: 30 });
  });

  it("internal: 500", () => {
    expect(internal("db down")).toMatchObject({ status: 500, code: "internal", message: "Something went wrong", detail: "db down" });
  });

  it("approvalRequired: 403, policy_key always present, approval_id only when given", () => {
    const bare = approvalRequired("ledger.payout");
    expect(bare).toMatchObject({ status: 403, code: "approval_required", message: "Approval required", detail: "ledger.payout" });
    expect(bare.extras).toEqual({ policy_key: "ledger.payout" });

    const withId = approvalRequired("ledger.payout", "apr_1");
    expect(withId.extras).toEqual({ policy_key: "ledger.payout", approval_id: "apr_1" });
  });

  it("mfaRequired: 403, step drives both detail and extras", () => {
    const verify = mfaRequired("verify");
    expect(verify).toMatchObject({ status: 403, code: "mfa_required", message: "Second factor required", detail: "verify" });
    expect(verify.extras).toEqual({ step: "verify" });

    const enrol = mfaRequired("enrol");
    expect(enrol.extras).toEqual({ step: "enrol" });
  });

  it("consentRequired: 403, purpose drives both detail and extras", () => {
    const err = consentRequired("marketing");
    expect(err).toMatchObject({ status: 403, code: "consent_required", message: "Consent required", detail: "marketing" });
    expect(err.extras).toEqual({ purpose: "marketing" });
  });

  it("notEntitled: 402, feature drives both detail and extras", () => {
    const err = notEntitled("north.board_packs");
    expect(err).toMatchObject({ status: 402, code: "not_entitled", message: "Not included in this plan", detail: "north.board_packs" });
    expect(err.extras).toEqual({ feature: "north.board_packs" });
  });
});

describe("toProblem (module function)", () => {
  it("converts an AppError via its own toProblem, passing instance through", () => {
    const err = notFound("approval");
    expect(toProblem(err, "req_9")).toEqual(err.toProblem("req_9"));
  });

  it("maps a ForbiddenError-named Error to 403 forbidden, carrying its permission", () => {
    const err = new Error("nope") as Error & { permission?: string };
    err.name = "ForbiddenError";
    err.permission = "axis:cases:approve";
    expect(toProblem(err)).toEqual(forbidden("axis:cases:approve").toProblem());
  });

  it("never leaks a plain Error's message: it becomes a generic 500", () => {
    const err = new Error("stack trace with secrets");
    const problem = toProblem(err);
    expect(problem).toEqual(internal().toProblem());
    expect(problem.title).not.toContain("secrets");
  });

  it("never leaks a non-Error thrown value: it becomes a generic 500", () => {
    expect(toProblem("just a string")).toEqual(internal().toProblem());
    expect(toProblem(null)).toEqual(internal().toProblem());
    expect(toProblem(undefined)).toEqual(internal().toProblem());
  });

  it("does not treat an Error whose name isn't exactly ForbiddenError as one", () => {
    const err = new Error("nope");
    err.name = "TypeError";
    expect(toProblem(err)).toEqual(internal().toProblem());
  });
});
