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
/**
 * Turnstile's script and the iframe it mounts (docs/10 §6, components/turnstile.tsx).
 * One named Cloudflare host, not a wildcard — the widget is the only third-party
 * code any document here is allowed to load.
 */
const TURNSTILE_HOST = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE_HOST}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `frame-src ${TURNSTILE_HOST}`,
    `connect-src 'self' ${TURNSTILE_HOST}`,
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
  // Once the Response below exists, its status is on the wire. An error React
  // reports *after* that — a boundary blowing up mid-stream — can still be
  // logged, but must not pretend it can change a status nobody reads again.
  // Everything React reports before it (a boundary that errored during the
  // shell pass, or anything at all on the crawler path, which waits for
  // `allReady` first) does still change it: that is the read this guards.
  let statusSent = false;
  // React reports an abort exactly the way it reports a fault: onError with the
  // signal's reason, plus a rejection of the shell promise if the shell had not
  // flushed yet. The reason's shape is not dependable (workerd may abort with
  // none, and React then invents `Error("The render was aborted by the server
  // without a reason.")`), so the discriminator is the signal itself — the same
  // one react-router's own default errorHandler uses. A client that walked away
  // is not a server fault: never a 500, and never a line in the log, which
  // Playwright pipes.
  const rethrowUnlessAborted = (error: unknown) => {
    if (!request.signal.aborted) throw error;
  };
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
      // Without this the render has no way to hear the client hang up, and
      // finishes the whole document into a dead socket.
      signal: request.signal,
      onError(error: unknown) {
        if (request.signal.aborted) return;
        if (!statusSent) status = 500;
        console.error(error);
      }
    }
  ).catch((error: unknown) => {
    rethrowUnlessAborted(error);
    return null;
  });
  // Aborted before the shell flushed, so React rejected instead of resolving.
  // Throwing here would make react-router render the whole document a second
  // time to build an error page — for a client that is already gone.
  if (!body) return new Response(null, { status: 499 });

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
  statusSent = true;
  return new Response(body, { status, headers: responseHeaders });
}
