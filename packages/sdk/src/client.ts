import { OPERATIONS, type OperationId, type Operations } from "./generated.js";

// A thin typed wrapper over fetch. Deliberately not a framework: the operation
// id carries the method and the path template, the generated types carry the
// shapes, and everything else here is the four things every caller would
// otherwise reimplement — auth, idempotency, the approval retry, and turning an
// RFC 9457 problem document into a throwable.

/** RFC 9457 problem document (apps/api errors.ts). Extensions come as extra keys. */
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

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  /** `x-request-id` — quote this when reporting a failure. */
  readonly requestId: string | null;

  constructor(problem: Problem, requestId: string | null) {
    super(problem.detail ? `${problem.title}: ${problem.detail}` : problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.problem = problem;
    this.requestId = requestId;
  }

  /** `bad_request`, `forbidden`, `approval_required`, `mfa_required`, … */
  get code(): string {
    return this.problem.code;
  }

  /** Present on `approval_required`: the pending approval to chase. */
  get approvalId(): string | undefined {
    const id = this.problem.approval_id;
    return typeof id === "string" ? id : undefined;
  }

  /** Present on `mfa_required`: which second-factor screen to draw. */
  get mfaStep(): "verify" | "enrol" | undefined {
    const step = this.problem.step;
    return step === "verify" || step === "enrol" ? step : undefined;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** e.g. `https://api.lyra.vantax.co.za` — no trailing slash needed. */
  baseUrl: string;
  /** `Authorization: Bearer …` — a session token or a partner API key. */
  token?: string;
  /**
   * Send the session cookie instead. First-party web app: `"include"`.
   * Spelled out rather than reusing the DOM's `RequestCredentials`, which does
   * not exist in a Workers or Node lib.
   */
  credentials?: "include" | "same-origin" | "omit";
  fetch?: FetchLike;
  /** Sent on every request; per-call headers win. */
  headers?: Record<string, string>;
  /**
   * Called when a consequential write is refused pending approval. Resolve true
   * once the approval has been granted — the identical request is then replayed
   * exactly once. Resolve false (the default) to let the ApiError through.
   */
  onApprovalRequired?: (error: ApiError) => boolean | Promise<boolean>;
}

/** Exact-match column filters the CRUD lister accepts alongside the paged query. */
export type Filters = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  /** Replays of a create with the same key return the first result (docs/19). */
  idempotencyKey?: string;
  /** Sent as `x-approval-id` when replaying an approval-gated write. */
  approvalId?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type Given<K extends string, T> = [T] extends [never] ? { [P in K]?: undefined } : { [P in K]: T };

export type CallInput<Id extends OperationId> = Given<"params", Operations[Id]["params"]> &
  ([Operations[Id]["query"]] extends [never]
    ? { query?: undefined }
    : { query?: Operations[Id]["query"] & Filters }) &
  Given<"body", Operations[Id]["body"]> &
  RequestOptions;

/** What `POST /v1/auth/login` answers with. `mfaStep` is absent when there is nothing to do. */
export interface LoginResult {
  token: string;
  expiresAt: number;
  mfaRequired: boolean;
  mfaStep?: "verify" | "enrol";
  user: { id: string; name: string; email: string; locale: string; tenantId: string };
  roles: string[];
}

export class LyraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private token: string | undefined;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.token = options.token;
  }

  /** After a login, or after rotating an API key. */
  setToken(token: string | undefined): void {
    this.token = token;
  }

  async call<Id extends OperationId>(id: Id, input: CallInput<Id>): Promise<Operations[Id]["result"]> {
    const meta = OPERATIONS[id];
    if (!meta) throw new Error(`unknown operation ${String(id)}`);
    const [method, template] = String(id).split(" ") as [string, string];

    const path = template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = (input.params as Record<string, string> | undefined)?.[name];
      if (value === undefined) throw new Error(`${String(id)}: missing path parameter ${name}`);
      return encodeURIComponent(value);
    });

    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries((input.query ?? {}) as Filters)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // Serialised once: an approval replay has to be byte-identical, and an
    // idempotency key over a re-stringified object is a key over a different
    // body the moment a value round-trips differently.
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);

    const res = await this.send(method, url.toString(), body, input, input.approvalId);
    if (res.ok) return (await decode(res)) as Operations[Id]["result"];

    const error = await toError(res);
    if (error.code === "approval_required" && this.options.onApprovalRequired) {
      if (await this.options.onApprovalRequired(error)) {
        const retry = await this.send(method, url.toString(), body, input, error.approvalId);
        if (retry.ok) return (await decode(retry)) as Operations[Id]["result"];
        throw await toError(retry);
      }
    }
    throw error;
  }

  /** Password login. Check `mfaRequired` before assuming the session can do anything. */
  async login(email: string, password: string, tenantSlug?: string): Promise<LoginResult> {
    const result = (await this.call("POST /v1/auth/login", {
      body: { email, password, ...(tenantSlug ? { tenantSlug } : {}) }
    })) as unknown as LoginResult;
    if (result.token) this.setToken(result.token);
    return result;
  }

  private send(
    method: string,
    url: string,
    body: string | undefined,
    options: RequestOptions,
    approvalId: string | undefined
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/json",
      ...this.options.headers,
      ...options.headers
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    // The approval that authorises the write is looked up by subject, so the
    // replay is the same request again; the header names which approval the
    // caller believes it is spending, and the API allows it through CORS.
    if (approvalId) headers["x-approval-id"] = approvalId;

    return this.fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(this.options.credentials ? { credentials: this.options.credentials } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
  }
}

async function decode(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

/** Any failure becomes a problem document, even when the hop that failed is not ours. */
async function toError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get("x-request-id");
  let problem: Problem = {
    type: "about:blank",
    title: res.statusText || "Request failed",
    status: res.status,
    code: "unknown"
  };
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      const parsed = JSON.parse(text) as Partial<Problem>;
      // A gateway or a proxy can answer with JSON that is not a problem
      // document; keep the status we actually got either way.
      if (parsed && typeof parsed === "object") {
        problem = { ...problem, ...parsed, status: parsed.status ?? res.status };
      }
    } catch {
      problem.detail = text.slice(0, 500);
    }
  }
  return new ApiError(problem, requestId);
}
