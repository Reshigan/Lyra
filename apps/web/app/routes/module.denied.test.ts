import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { loader } from "./module";

// A tab the actor may not read is a closed door, not a broken screen. The API
// answers 403; if the loader lets that surface as a plain error the runtime
// renders 500 and the person is told the page failed, which is untrue.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubProblem(status: number, code: string) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ title: "Not permitted", status, code }), {
        status,
        headers: { "content-type": "application/json", "x-request-id": "req_01" }
      })
    )
  );
}

 
function args(module: string, resource?: string): any {
  return {
    request: new Request(`https://web.test/${module}${resource ? `/${resource}` : ""}`),
    params: resource ? { module, resource } : { module },
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("a refusal reaches the error boundary as itself", () => {
  it("turns a 403 from the API into a 403 route error", async () => {
    stubProblem(403, "forbidden");
    const thrown = await loader(args("admin", "event-dlq")).catch((error: unknown) => error);

    // The router turns a thrown `data()` into the route error root.tsx reads:
    // the status picks the copy, and its data is printed as the request id —
    // the one thing support asks for.
    expect(thrown).toMatchObject({ data: "req_01", init: { status: 403 } });
  });

  it("keeps a 404 a 404 rather than a crash", async () => {
    stubProblem(404, "not_found");
    const thrown = await loader(args("ledger", "accounts")).catch((error: unknown) => error);

    expect(thrown).toMatchObject({ init: { status: 404 } });
  });

  it("sends a workspace landing to the first tab the actor can read", async () => {
    // `/admin` has no resource of its own: it lands on the first declared tab,
    // which here is `tenants`. An actor who holds only `core:teams:read` should
    // arrive at their teams, not at a refusal for a tab they never asked for.
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ permissions: ["core:teams:read"] }), {
            headers: { "content-type": "application/json" }
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ title: "Not permitted", status: 403 }), {
          status: 403,
          headers: { "content-type": "application/json" }
        })
      );
    });

    const thrown: unknown = await loader(args("admin")).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toBe("/admin/teams");
  });

  it("still refuses a workspace the actor can read no part of", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes("/v1/me")
          ? new Response(JSON.stringify({ permissions: [] }), {
              headers: { "content-type": "application/json" }
            })
          : new Response(JSON.stringify({ title: "Not permitted", status: 403 }), {
              status: 403,
              headers: { "content-type": "application/json" }
            })
      )
    );

    const thrown = await loader(args("admin")).catch((error: unknown) => error);

    expect(thrown).toMatchObject({ init: { status: 403 } });
  });

  it("lets a genuine fault stay a fault", async () => {
    // A transport failure is not a refusal: nothing about it belongs on a
    // "not permitted" page, so it must reach the boundary untouched.
    const boom = new TypeError("network down");
    vi.stubGlobal("fetch", () => Promise.reject(boom));
    const thrown = await loader(args("ledger", "accounts")).catch((error: unknown) => error);

    expect(thrown).toBe(boom);
  });
});
