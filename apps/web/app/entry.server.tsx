import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";

// Workers has no Node streams; react-dom's web-stream renderer is the one that
// runs here. Crawlers get the whole document, people get it as it comes.

/**
 * The policy for one document. `script-src` carries that document's nonce —
 * without it `default-src 'self'` refuses React Router's inline hydration
 * scripts and the page never becomes interactive.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
): Promise<Response> {
  let status = responseStatusCode;
  // React Router hands the browser its router context and hydration call as
  // inline <script> tags. Under `default-src 'self'` the browser refuses to run
  // them, so the document renders and then nothing ever hydrates — every
  // client-side surface (⌘K, dialogs, ghost text, the theme toggle) is dead
  // while the page looks fine. One per-request nonce, on the policy and on the
  // scripts: ServerRouter passes it down to <Scripts>/<ScrollRestoration>.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      onError(error: unknown) {
        status = 500;
        console.error(error);
      }
    }
  );

  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;

  responseHeaders.set("content-type", "text/html; charset=utf-8");
  // docs/10 §6: security headers. script-src names this request's nonce rather
  // than 'unsafe-inline', so the framework's own inline scripts run and an
  // injected one still does not.
  responseHeaders.set("content-security-policy", contentSecurityPolicy(nonce));
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
