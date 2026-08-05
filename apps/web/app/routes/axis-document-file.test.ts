import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { loader } from "./axis-document-file";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function args(id = "doc_1"): LoaderFunctionArgs {
  return {
    request: new Request(`https://web.test/axis/documents/${id}/file`),
    context: { get: () => ({ env, ctx: null }) },
    params: { id }
  } as unknown as LoaderFunctionArgs;
}

describe("loader", () => {
  it("streams the API's bytes and content type through untouched", async () => {
    const bytes = new TextEncoder().encode("stub image bytes");
    vi.stubGlobal(
      "fetch",
      async () => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })
    );

    const res = await loader(args());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("encodes the document id rather than splicing it raw into the upstream path", async () => {
    let requestedUrl = "";
    vi.stubGlobal("fetch", (input: URL | string) => {
      requestedUrl = String(input);
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await loader(args("doc/1 a"));

    expect(requestedUrl).toBe("https://api.test/v1/axis/documents/doc%2F1%20a/file");
  });

  // Regression: a raw `Response` here drops the security headers withHeaders
  // (apps/api/src/mw.ts) normally sets, which combined with an inline
  // content-disposition on an attacker-controlled content-type is a
  // same-origin stored-XSS vector.
  it("sets the security headers apps/api's withHeaders would have set", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } })
    );

    const res = await loader(args());

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("forces attachment for a content-type outside the render-safe allowlist, even if upstream said inline", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/html", "content-disposition": "inline" }
        })
    );

    const res = await loader(args());

    expect(res.headers.get("content-disposition")).toBe("attachment");
  });

  it("allows inline for a render-safe content-type", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf" } })
    );

    const res = await loader(args());

    expect(res.headers.get("content-disposition")).toBe("inline");
  });
});
