// Problem + ApiError live outside api.server.ts because shared kits
// (detail-kit) do `instanceof ApiError` and are bundled for the client;
// importing a `.server` module from there is a build error. This file has no
// secrets and no fetch — just the error shape.

/** RFC 9457. apps/api renders every failure in this shape (docs/04 §1). */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Field-level validation errors, keyed by dotted path. */
  errors?: Record<string, string>;
  /**
   * `x-request-id` from the response, copied here so every screen that
   * narrows an ApiError down to just its problem still has it (docs/15
   * checklist item 10 — an error state without this has nothing for support
   * to look up). Not part of the wire format; set by `ApiError.from` below.
   */
  requestId?: string;
}

/**
 * Which submitted fields the API rejected, as `name -> true`, keyed by the
 * `name` on the input (apps/api/src/http.ts:33 joins the zod path with dots,
 * which is the same key the form posts). Empty when the failure was not a
 * field-level validation one.
 *
 * The *messages* in `problem.errors` are zod's own English ("String must
 * contain at least 2 character(s)") and no schema in the API overrides them,
 * so they cannot be shown to an Arabic reader (CLAUDE.md §7). The key is the
 * translatable half: it says which input to mark, and the screen supplies its
 * own wording. Keeping the map itself out of the UI is deliberate.
 */
export function invalidFields(problem: Problem | null | undefined): Set<string> {
  if (!problem || problem.status !== 400 || !problem.errors) return new Set();
  return new Set(Object.keys(problem.errors).filter((key) => key !== "_"));
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
    if (requestId) problem.requestId = requestId;
    return new ApiError(problem, requestId);
  }
}
