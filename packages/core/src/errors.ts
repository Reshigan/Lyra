// RFC 9457 problem+json (docs/04 §1). Every error leaving the API is one of these.

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  /** Field-level validation failures, `{ "customer.email": "invalid" }`. */
  errors?: Record<string, string>;
  [ext: string]: unknown;
}

const TYPE_BASE = "https://lyra.app/problems/";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly extras: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    detail?: string,
    extras: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extras = extras;
  }

  toProblem(instance?: string): Problem {
    return {
      type: `${TYPE_BASE}${this.code}`,
      title: this.message,
      status: this.status,
      code: this.code,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(instance === undefined ? {} : { instance }),
      ...this.extras
    };
  }
}

export const badRequest = (detail?: string, errors?: Record<string, string>) =>
  new AppError(400, "bad_request", "Bad request", detail, errors ? { errors } : {});
export const unauthorized = (detail?: string) =>
  new AppError(401, "unauthorized", "Authentication required", detail);
export const forbidden = (permission?: string) =>
  new AppError(403, "forbidden", "Not permitted", permission, permission ? { permission } : {});
export const notFound = (resource = "resource") =>
  new AppError(404, "not_found", "Not found", resource);
export const conflict = (detail?: string) => new AppError(409, "conflict", "Conflict", detail);
export const gone = (detail?: string) => new AppError(410, "gone", "No longer available", detail);
export const unprocessable = (detail?: string, errors?: Record<string, string>) =>
  new AppError(422, "unprocessable", "Cannot process", detail, errors ? { errors } : {});
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, "rate_limited", "Too many requests", undefined, { retry_after: retryAfterSec });
export const internal = (detail?: string) =>
  new AppError(500, "internal", "Something went wrong", detail);

/** Approval-gated action attempted without one (docs/12 §4). */
export const approvalRequired = (policyKey: string, approvalId?: string) =>
  new AppError(
    403,
    "approval_required",
    "Approval required",
    policyKey,
    approvalId ? { policy_key: policyKey, approval_id: approvalId } : { policy_key: policyKey }
  );

/**
 * The session is real but has not cleared the second factor (PLAT-012/013).
 * `step` tells the client which screen to draw: an enrolled user types a code,
 * a staff account that never enrolled has to enrol before it can work.
 */
export const mfaRequired = (step: "verify" | "enrol") =>
  new AppError(403, "mfa_required", "Second factor required", step, { step });

/** Consent missing for the purpose being attempted (docs/12 §2). */
export const consentRequired = (purpose: string) =>
  new AppError(403, "consent_required", "Consent required", purpose, { purpose });

/** Tenant is not entitled to the edition/feature (docs/21). */
export const notEntitled = (feature: string) =>
  new AppError(402, "not_entitled", "Not included in this plan", feature, { feature });

/** Never leak internals: unknown errors become a generic 500. */
export function toProblem(err: unknown, instance?: string): Problem {
  if (err instanceof AppError) return err.toProblem(instance);
  if (err instanceof Error && err.name === "ForbiddenError") {
    return forbidden((err as Error & { permission?: string }).permission).toProblem(instance);
  }
  return internal().toProblem(instance);
}
