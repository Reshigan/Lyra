import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";

// Workers has no Node streams; react-dom's web-stream renderer is the one that
// runs here. Crawlers get the whole document, people get it as it comes.

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
): Promise<Response> {
  let status = responseStatusCode;
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        status = 500;
        console.error(error);
      }
    }
  );

  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;

  responseHeaders.set("content-type", "text/html; charset=utf-8");
  // docs/10 §6: security headers. Vite's dev/build output is hashed inline
  // scripts/styles under React Router's own nonce-free bundling, so 'self' plus
  // the framework's own asset origin covers it without 'unsafe-inline'.
  responseHeaders.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  );
  responseHeaders.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  responseHeaders.set("x-frame-options", "DENY");
  responseHeaders.set("x-content-type-options", "nosniff");
  // "no-referrer" forces a same-origin POST's Origin header to the literal
  // string "null" (Fetch spec §4.7), which react-router's CSRF guard
  // (throwIfPotentialCSRFAttack) doesn't special-case — it treats "null" as a
  // foreign origin and 400s the request. strict-origin-when-cross-origin
  // keeps the same cross-origin/downgrade privacy guarantees without that.
  responseHeaders.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(body, { status, headers: responseHeaders });
}
