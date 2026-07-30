// The one place this app talks to apps/api. Mobile has no cookie jar worth
// trusting, so it authenticates with `Authorization: Bearer <session token>` —
// the same opaque session token /v1/auth/login returns to the web shell in its
// Set-Cookie. apps/api accepts either (apps/api/src/auth.ts).

/** Base URL of apps/api. Public config, never a secret — see README. */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.lyra.vantax.co.za";

/** RFC 9457, the shape apps/api renders every failure in (docs/04 §1). */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly problem: Problem,
    /** `x-request-id` from the response — the one thing support needs. */
    readonly requestId: string | null
  ) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }

  get status(): number {
    return this.problem.status;
  }
}

/** A dropped connection is not a 500; it needs its own message and a retry. */
export class NetworkError extends Error {
  readonly name = "NetworkError";
}

export interface RequestOptions {
  token?: string | null;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, method = "GET", body, signal } = options;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(new URL(path, API_BASE).toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {})
    });
  } catch (cause) {
    // fetch only rejects for transport failures; anything else is a status.
    throw new NetworkError(cause instanceof Error ? cause.message : "request failed");
  }

  if (!response.ok) throw await problemFrom(response, path);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function problemFrom(response: Response, path: string): Promise<ApiError> {
  let problem: Problem = { title: response.statusText || "error", status: response.status };
  try {
    const parsed: unknown = await response.json();
    // Trust the shape only far enough to read it: a proxy error page is HTML
    // behind a JSON content type often enough to matter.
    if (parsed && typeof parsed === "object" && "status" in parsed) {
      const p = parsed as Problem;
      problem = { ...p, status: Number(p.status) || response.status };
    }
  } catch {
    /* keep the status-derived problem */
  }
  problem.instance ??= path;
  return new ApiError(problem, response.headers.get("x-request-id"));
}

/* ------------------------------------------------------------------ shapes */

export interface LoginResponse {
  token: string;
  expiresAt: number;
  mfaRequired: boolean;
  /** Which second-factor screen to draw. Absent when there is nothing to clear. */
  mfaStep?: MfaStep;
  user: { id: string; name: string; email: string; locale: string; tenantId: string };
  roles: string[];
}

export type MfaStep = "verify" | "enrol";

/** Enrolment returns the shared secret exactly once (apps/api/src/auth.ts). */
export interface Enrolment {
  secret: string;
  otpauthUri: string;
}

export interface NavItem {
  /** i18n key — the API never sends display text (docs/07 §2). */
  labelKey: string;
  href: string;
  icon: string;
  children?: NavItem[];
}

/** The whitelabel contract, docs/01 §6. All optional: a tenant that overrides
 *  nothing gets the default Deep Field skin. */
export interface Brand {
  name?: string;
  logo?: { light?: string; dark?: string; mark?: string };
  palette?: { accent?: string; accentHover?: string; accentContrast?: string };
}

export interface Me {
  actor: { kind: string; id: string };
  profile: { id: string; name: string; email: string; locale: string; status: string } | null;
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    region: string;
    status: string;
    brand: Brand | null;
  };
  locale: string;
  roles: string[];
  permissions: string[];
  entitlements: Record<string, unknown>;
  policy: Record<string, unknown>;
  nav: NavItem[];
}

/** Every generated CRUD list answers in this shape (apps/api/src/http.ts). */
export interface Page<T> {
  data: T[];
  /** Opaque; pass back as `?cursor=`. Absent once the last page has been read. */
  cursor?: string;
  total?: number;
}

export type Row = Record<string, unknown> & { id: string };

export const login = (
  body: { email: string; password: string; tenantSlug?: string },
  signal?: AbortSignal
): Promise<LoginResponse> =>
  request<LoginResponse>("/v1/auth/login", { method: "POST", body, ...(signal ? { signal } : {}) });

/**
 * The TOTP second factor. Accepts a TOTP code or a single-use recovery code;
 * a code that is neither is a 401, which the caller reads as "wrong code".
 */
export const verifyMfa = (
  token: string,
  code: string
): Promise<{ mfaSatisfied: true; usedRecovery: boolean }> =>
  request("/v1/auth/mfa/verify", { method: "POST", token, body: { code } });

/** Begins enrolment for a session whose role requires a factor it has not set up. */
export const startEnrolment = (token: string): Promise<Enrolment> =>
  request<Enrolment>("/v1/auth/mfa/enrol", { method: "POST", token });

/** Proves the authenticator was captured. Clears the factor on this session and
 *  returns the recovery codes — the only time they are readable. */
export const confirmEnrolment = (token: string, code: string): Promise<string[]> =>
  request<{ recoveryCodes: string[] }>("/v1/auth/mfa/enrol/confirm", {
    method: "POST",
    token,
    body: { code }
  }).then((r) => r.recoveryCodes);

/* --------------------------------------------------------- the step machine */

// The same four steps apps/web/app/routes/login.tsx walks, kept here as pure
// functions so both the screen and the session agree on where a response lands
// and so the transitions are testable without rendering anything.

export type AuthStep = "password" | "totp" | "enrol" | "recovery" | "app";

/** Where a successful /v1/auth/login puts the user. */
export function stepAfterLogin(result: Pick<LoginResponse, "mfaRequired" | "mfaStep">): AuthStep {
  if (result.mfaStep === "enrol") return "enrol";
  return result.mfaRequired ? "totp" : "app";
}

/** Where clearing the current step lands: a verified code opens the app, a
 *  confirmed enrolment owes the user their recovery codes first. */
export function stepAfterClearing(step: AuthStep): AuthStep {
  return step === "enrol" ? "recovery" : "app";
}

/**
 * The step a 403 from any authenticated call demands, or null when the failure
 * is not about the second factor. A session that exists but has not cleared MFA
 * must not read as a sign-out.
 */
export function mfaStepOf(error: unknown): AuthStep | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const { type, title, step, detail } = error.problem as Problem & { step?: unknown };
  if (!/mfa_required/.test(type ?? title)) return null;
  const named = typeof step === "string" ? step : detail;
  return named === "enrol" ? "enrol" : "totp";
}

export const fetchMe = (token: string, signal?: AbortSignal): Promise<Me> =>
  request<Me>("/v1/me", { token, ...(signal ? { signal } : {}) });

export const logout = (token: string): Promise<void> =>
  request<void>("/v1/auth/logout", { method: "POST", token });

export const listRows = (
  token: string,
  resource: string,
  signal?: AbortSignal
): Promise<Page<Row>> =>
  request<Page<Row>>(`/v1/${resource}?limit=50`, { token, ...(signal ? { signal } : {}) });

export const getRow = (
  token: string,
  resource: string,
  id: string,
  signal?: AbortSignal
): Promise<Row> =>
  request<Row>(`/v1/${resource}/${encodeURIComponent(id)}`, {
    token,
    ...(signal ? { signal } : {})
  });
