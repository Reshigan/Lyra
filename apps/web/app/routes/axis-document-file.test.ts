import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { loader } from "./axis-document-file";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function args(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/documents/doc_1/file"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "doc_1" }
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
});
