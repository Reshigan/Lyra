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
