import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HIDDEN_ROUTES } from "./routing";

// The inverse of modules/spec.routes.test.ts. That one breaks on a link with no
// screen; this one breaks on a screen with no link.
//
// `HIDDEN_ROUTES` is a map of route to *why it never appears in the nav*, and
// most entries answer with a reachability claim — "opened from that partner,
// channel or staff record". Nothing verified those claims, so
// `/onboarding/:kind/:ref` sat fully implemented and unreachable: a real screen,
// a documented opener, and no path builder anywhere in the app. That is the
// dead-seam shape from the other direction, and the tell was a comment in
// portal.$tenantSlug.partners.tsx describing the screen staff supposedly reach.
//
// Only parameterised routes are checked. A static href is greppable as a
// literal and `spec.routes.test.ts` already covers the module specs; a route
// with a `:param` can only be reached by code that *builds* the path, which is
// the thing that goes missing.

const APP = import.meta.dirname;

/** Claims an opener inside the app — as opposed to a marketing link, a token'd
 *  email or a storefront footer, none of which this repo builds. */
const IN_APP = /opened from|linked from|reached from/;
const EXTERNAL = /no session and no shell|marketing link|storefront footer|one-time token/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(e.name) || e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) return [];
    // routing.ts is the claim itself; routes.ts only declares the screens.
    if (path === join(APP, "routing.ts") || path === join(APP, "routes.ts")) return [];
    return [readFileSync(path, "utf8")];
  });
}

const CORPUS = sources(APP);

/**
 * Does anything build this path? A builder writes the literal segments before
 * the first `:param` and then interpolates — `/onboarding/${kind}/${ref}`,
 * `"/onboarding/" + kind`, or a spec `recordLink` href whose `{id}` record.tsx
 * substitutes. Matching on that prefix is what separates a real builder from a
 * bare mention in prose.
 */
function built(pattern: string): boolean {
  const prefix = pattern.split("/:")[0]!;
  // Literal prefix, then any further literal segments, then the interpolation:
  // `${…}` for a template, `{id}` for a spec recordLink href.
  // `["'\`]` anchors the start of the string literal, which is what keeps
  // `/v1/onboarding/partners/${ref}` — an API call, not a screen — from
  // answering for `/onboarding/:kind/:ref`.
  const builder = new RegExp(`["'\`]${prefix}(?:/[\\w.-]+)*/(?:\\$\\{|\\{)`);
  return CORPUS.some((src) => builder.test(src));
}

describe("every parameterised hidden route has something that builds its path", () => {
  const claims = Object.entries(HIDDEN_ROUTES).filter(
    ([path, why]) => path.includes("/:") && IN_APP.test(why) && !EXTERNAL.test(why)
  );

  // A generic pattern (`/:module/:resource`) has no literal prefix to key off —
  // record.tsx builds those, and spec.routes.test.ts already holds them.
  const checkable = claims.filter(([path]) => !path.startsWith("/:"));

  it("has claims to check", () => {
    expect(checkable.length).toBeGreaterThan(5);
  });

  for (const [path, why] of checkable) {
    it(`${path} is opened from somewhere`, () => {
      expect(built(path), `routing.ts says "${why}" — but nothing builds ${path}`).toBe(true);
    });
  }
});
