import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { PAGE_SIZES, loader, pageSizeIn } from "./module";

// Every list screen paged 50 rows at a time and offered no way to say
// otherwise, while the API has taken a `limit` since it was written
// (apps/api/src/http.ts ListQuery). docs/ui.md §7.6.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records the API URLs the loader asks for and answers every one with a page. */
function capture(): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
  });
  return seen;
}


function args(url: string): any {
  return {
    request: new Request(url),
    params: { module: "admin", resource: "users" },
    context: { get: () => ({ env, ctx: {} }) }
  };
}

describe("pageSizeIn", () => {
  it("takes a size the picker actually offers", () => {
    for (const size of PAGE_SIZES) {
      expect(pageSizeIn(new URLSearchParams(`limit=${size}`))).toBe(size);
    }
  });

  it("ignores anything else rather than passing it to the API", () => {
    // A hand-typed `?limit=10000` is not a page size, it is a way to ask the
    // API for the whole tenant; the API caps it, and this refuses it first.
    expect(pageSizeIn(new URLSearchParams("limit=10000"))).toBeNull();
    expect(pageSizeIn(new URLSearchParams("limit=0"))).toBeNull();
    expect(pageSizeIn(new URLSearchParams("limit=fifty"))).toBeNull();
    expect(pageSizeIn(new URLSearchParams())).toBeNull();
  });
});

describe("the list loader", () => {
  it("asks the API for the size the actor chose", async () => {
    const seen = capture();
    await loader(args("https://web.test/admin/users?limit=100"));
    expect(seen[0]).toContain("limit=100");
  });

  it("says nothing about limit when nobody chose one", async () => {
    const seen = capture();
    await loader(args("https://web.test/admin/users"));
    expect(seen[0]).not.toContain("limit=");
  });
});
