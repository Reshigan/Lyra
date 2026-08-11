import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./entry.server.js";

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
