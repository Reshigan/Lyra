import { createElement, Suspense, use, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// entry.server's own work is the envelope around the render: the nonce, the
// headers, the status, and what it does when the render dies or the client
// walks away. Standing in for ServerRouter is what lets those last two be
// provoked on purpose — the real router, given a real context, only succeeds.
let renderRoot: () => ReactNode = () => null;
vi.mock("react-router", () => ({
  ServerRouter: () => renderRoot()
}));

import handleRequest, { contentSecurityPolicy } from "./entry.server.js";

// Regression: the policy used to stop at `default-src 'self'`, which the
// browser reads as "no inline scripts" — so React Router's hydration script was
// refused on every document and nothing client-side ever ran. Live, silently:
// the server-rendered HTML looks correct, and only interaction is dead.
describe("contentSecurityPolicy", () => {
  it("lets the document's own inline scripts run, by nonce", () => {
    const policy = contentSecurityPolicy("abc123");

    expect(policy).toContain("script-src 'self' 'nonce-abc123'");
    // A blanket 'unsafe-inline' would also make hydration work, and would make
    // any injected script work too. It must not be how this is fixed.
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("keeps the rest of docs/10 §6 intact", () => {
    const policy = contentSecurityPolicy("abc123");

    for (const directive of [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'none'"
    ])
      expect(policy).toContain(directive);
  });

  it("admits the Turnstile widget by host, and nothing else third-party", () => {
    const policy = contentSecurityPolicy("abc123");

    // Script, iframe and the widget's own XHR back to Cloudflare — miss any one
    // and the challenge silently fails to render on the public forms.
    expect(policy).toContain("script-src 'self' 'nonce-abc123' https://challenges.cloudflare.com");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy).toContain("connect-src 'self' https://challenges.cloudflare.com");
    // One named host, never a wildcard.
    expect(policy).not.toContain("*");
  });
});

/** A child that never settles, so the document is still open when it is cut. */
const never = new Promise<never>(() => {});
const Pending = () => use(never);
/** A child that throws while React is still building the shell. */
const Boom = (): ReactNode => {
  throw new Error("boom");
};
const inBoundary = (child: ReactNode) => createElement(Suspense, { fallback: null }, child);

const documentRequest = (signal: AbortSignal | null = null) =>
  new Request("https://lyra.test/north/brief", { signal });
/** A crawler waits for `allReady`, so its whole document precedes the Response. */
const crawlerRequest = () =>
  new Request("https://lyra.test/north/brief", { headers: { "user-agent": "Googlebot/2.1" } });
/** Reads the response to the end — it only returns if the stream terminates. */
const drain = (response: Response) => new Response(response.body).text();

let logged: unknown[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(...args));
});

afterEach(() => {
  renderRoot = () => null;
  vi.restoreAllMocks();
});

// Regression: renderToReadableStream was called without a `signal`, so
// `request.signal` — the only thing that hears the client hang up — was never
// wired to the render. A cancelled navigation left the render finishing the
// whole document into a socket nobody was holding. And once the signal is
// wired, an abort arrives through the same onError as a genuine fault, so it
// must not be logged as one (Playwright pipes this server's stdout) nor become
// a 500.
describe("handleRequest, when the client leaves mid-render", () => {
  it("ends the stream instead of rendering on into a dead socket", async () => {
    renderRoot = () => inBoundary(createElement(Pending));
    const controller = new AbortController();

    const response = await handleRequest(
      documentRequest(controller.signal),
      200,
      new Headers(),
      {} as never
    );
    controller.abort();

    // Without the signal wired, `Pending` never settles and this never returns.
    await drain(response);
    expect(response.status).toBe(200);
    expect(logged).toEqual([]);
  });

  it("does not report an abort before the shell flushed as a server fault", async () => {
    renderRoot = () => createElement(Pending);
    const controller = new AbortController();

    // React rejects rather than resolving when the shell never made it out, and
    // that rejection carries the abort reason, not a render fault.
    const pending = handleRequest(
      documentRequest(controller.signal),
      200,
      new Headers(),
      {} as never
    );
    controller.abort();
    const response = await pending;

    expect(response.status).toBe(499);
    expect(logged).toEqual([]);
  });
});

// Regression: onError assigned `status = 500` unconditionally. That assignment
// is live for every error React reports before the Response is constructed, and
// dead for every error after it — where it silently mutated a variable nobody
// reads again.
describe("handleRequest, when the render errors", () => {
  it("serves 500 for an error React reports before the response exists", async () => {
    renderRoot = () => inBoundary(createElement(Boom));

    const response = await handleRequest(documentRequest(), 200, new Headers(), {} as never);
    await drain(response);

    expect(response.status).toBe(500);
    expect(logged).toContainEqual(expect.objectContaining({ message: "boom" }));
  });

  it("still serves a crawler 500 for an error found while waiting on allReady", async () => {
    // The live read this guards: the crawler branch buffers the whole document
    // *before* the Response is built, so an error React only reaches after the
    // shell flushed is still in time to set the status. Anything that keys the
    // 500 off "the shell has flushed" rather than "the status has been sent"
    // hands crawlers a 200 for a broken page.
    let fail: (error: Error) => void = () => {};
    const late = new Promise<never>((_, reject) => (fail = reject));
    renderRoot = () => inBoundary(createElement(() => use(late)));
    // A macrotask, so the shell has certainly flushed by the time it lands.
    setTimeout(() => fail(new Error("late")), 0);

    const response = await handleRequest(crawlerRequest(), 200, new Headers(), {} as never);

    expect(response.status).toBe(500);
  });

  it("logs an error after the response exists without pretending to restatus it", async () => {
    let fail: (error: Error) => void = () => {};
    const late = new Promise<never>((_, reject) => (fail = reject));
    renderRoot = () => inBoundary(createElement(() => use(late)));

    const response = await handleRequest(documentRequest(), 200, new Headers(), {} as never);
    // The status is already on the wire; only the boundary can still be told.
    fail(new Error("late"));
    await drain(response);

    expect(response.status).toBe(200);
    expect(logged).toContainEqual(expect.objectContaining({ message: "late" }));
  });
});
