import type { Env } from "./env";

// The only way this app talks to apps/api. Server-side by design: every call
// the shell makes happens in a loader or an action, so the session cookie never
// has to be readable by script and the API origin never reaches the client
// bundle. A browser-side call would import this file into the client — the
// `.server` suffix makes that a build error instead of a leak.

/** RFC 9457. apps/api renders every failure in this shape (docs/04 §1). */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Field-level validation errors, keyed by dotted path. */
  errors?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    readonly problem: Problem,
    /** `x-request-id` from the response. The one thing support needs. */
    readonly requestId: string | null
  ) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
  }

  get status(): number {
    return this.problem.status;
  }

  static async from(response: Response, path: string): Promise<ApiError> {
    const requestId = response.headers.get("x-request-id");
    let problem: Problem = { title: response.statusText || "error", status: response.status };
    try {
      const body: unknown = await response.json();
      // Trust the shape only far enough to read it; a proxy error page is HTML
      // with a JSON content type often enough to matter.
      if (body && typeof body === "object" && "status" in body) {
        problem = { ...(body as Problem), status: Number((body as Problem).status) || response.status };
      }
    } catch {
      /* keep the status-derived problem */
    }
    problem.instance ??= path;
    return new ApiError(problem, requestId);
  }
}

export interface ApiOptions {
  env: Env;
  /** The inbound request, so the caller's session cookie is forwarded. */
  request?: Request;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Raw response, for the few callers that need the headers (login relays cookies). */
export async function apiFetch(path: string, options: ApiOptions): Promise<Response> {
  const { env, request, method = "GET", body } = options;
  const headers = new Headers({ accept: "application/json", ...options.headers });
  if (body !== undefined) headers.set("content-type", "application/json");

  const cookie = request?.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  // Correlate the browser hop with the API hop; apps/api echoes its own id back.
  const inbound = request?.headers.get("x-request-id");
  if (inbound) headers.set("x-request-id", inbound);

  const response = await fetch(new URL(path, env.API_ORIGIN), {
    method,
    headers,
    // Belt and braces: the cookie header above is what actually authenticates a
    // server-to-server hop, but this keeps the call correct if it ever runs in
    // a browser context.
    credentials: "include",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(options.signal ? { signal: options.signal } : {})
  });

  if (!response.ok) throw await ApiError.from(response, path);
  return response;
}

/** Parsed JSON, or `undefined` for the 204s. */
export async function api<T>(path: string, options: ApiOptions): Promise<T> {
  const response = await apiFetch(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------- /v1/me */

export interface NavItem {
  /** i18n key — the API never sends display text (docs/07 §2). */
  labelKey: string;
  href: string;
  icon: string;
  children?: NavItem[];
}

/** The whitelabel contract, docs/01 §6. Everything optional: a tenant that
 *  overrides nothing renders the default Deep Field skin. */
export interface Brand {
  /** The product name this tenant sees. Hard-coding it is a bug (CLAUDE.md §5). */
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

/**
 * Everything the shell needs on first paint, in one round trip. There is no
 * /v1/me/nav or /v1/me/permissions — both arrive inside this body, already
 * filtered server-side by the actor's permissions.
 */
export function fetchMe(env: Env, request: Request): Promise<Me> {
  return api<Me>("/v1/me", { env, request });
}

/** Copy the API's Set-Cookie headers onto our own response, verbatim. */
export function relayCookies(from: Response, to: Headers): Headers {
  const cookies: string[] =
    typeof from.headers.getSetCookie === "function"
      ? from.headers.getSetCookie()
      : [from.headers.get("set-cookie") ?? ""].filter(Boolean);
  for (const cookie of cookies) to.append("set-cookie", cookie);
  return to;
}
