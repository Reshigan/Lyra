import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { loader } from "./case-evidence-download";

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function loaderArgs(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/cases/cas_1/evidence-bundles/evb_1/download"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "cas_1", bundleId: "evb_1" }
  } as unknown as LoaderFunctionArgs;
}

describe("case evidence download loader", () => {
  it("proxies the bundle bytes with the API's content-type", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    let requestedUrl = "";
    vi.stubGlobal("fetch", (input: URL | string) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=bundle.zip" }
        })
      );
    });

    const response = await loader(loaderArgs());

    expect(requestedUrl).toBe("https://api.test/v1/compliance/evidence-bundles/evb_1/download");
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
