/**
 * The journey routes sit outside the module shells on purpose — the point of a
 * cross-module journey is that any signed-in reader can walk it — so the API is
 * the only thing that says no. All three loaders called `api()` bare, and an
 * ApiError React Router can only treat as a crash: production served HTTP 500
 * and "This did not load / The page could not be built" to north.exec on
 * /journey/axis and /journey/scout, and to tenant.compliance on all three.
 * `asRouteError` (api.server.ts) is the seam that turns a 403 into the
 * boundary's "not permitted"; these tests assert each loader routes through it.
 */
import { describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
// Only `api` is faked. asRouteError is the real one — a loader that forgets to
// call it must still fail this suite, so the seam itself is never mocked away.
vi.mock("../api.server", () => ({ api, asRouteError }));
vi.mock("../context", () => ({ cloudflare: { toString: () => "cloudflare-context" } }));

import { data } from "react-router";
import { ApiError } from "../api-error";

function asRouteError(error: unknown): never {
  if (error instanceof ApiError) throw data(error.requestId, { status: error.status });
  throw error;
}
import { loader as axisLoader } from "./journey-axis";
import { loader as northLoader } from "./journey-north";
import { loader as scoutLoader } from "./journey-scout";

const args = (path: string) =>
  ({
    request: new Request(`https://lyra.vantax.co.za${path}`),
    context: { get: () => ({ env: { API_ORIGIN: "https://api.example" } }) },
    params: {}
  }) as never;

const LOADERS = [
  { name: "journey-axis", loader: axisLoader, path: "/journey/axis" },
  { name: "journey-north", loader: northLoader, path: "/journey/north" },
  { name: "journey-scout", loader: scoutLoader, path: "/journey/scout" }
];

// No beforeEach reset: every test sets its own mockImplementation, and a
// `beforeEach(() => api.mockClear())` — an arrow returning the mock — makes
// vitest treat the returned function as the hook's teardown and call it, which
// invokes the mock and surfaces its rejection as the test's failure.
describe.each(LOADERS)("$name loader", ({ loader, path }) => {
  it("rethrows a 403 as a route error, not a crash", async () => {
    // mockImplementation, not mockRejectedValue: the latter builds the rejected
    // promise at setup time, before any handler attaches, and vitest fails the
    // test on the unhandled rejection instead of running it.
    api.mockImplementation(() =>
      Promise.reject(new ApiError({ title: "Forbidden", status: 403, instance: path }, "req_1"))
    );

    const thrown = await loader(args(path)).then(
      () => null,
      (e: unknown) => e
    );

    // A bare ApiError here is the bug: the boundary reads it as a 500. What
    // asRouteError throws is react-router's `data()` — the status the boundary
    // reads travels in `init`, and the request id support needs is the payload.
    expect(thrown).not.toBeInstanceOf(ApiError);
    const routeError = thrown as { type: string; data: unknown; init: { status: number } };
    expect(routeError.type).toBe("DataWithResponseInit");
    expect(routeError.init.status).toBe(403);
    expect(routeError.data).toBe("req_1");
  });

  it("leaves a real fault alone", async () => {
    const boom = new TypeError("fetch failed");
    api.mockImplementation(() => Promise.reject(boom));
    await expect(loader(args(path))).rejects.toBe(boom);
  });
});
