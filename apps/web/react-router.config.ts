import type { Config } from "@react-router/dev/config";

export default {
  // SSR on: the shell paints from /v1/me on the server, so the first frame
  // already knows the actor, their nav and their locale (docs/15 §2).
  ssr: true,
  // Lazy route discovery deadlocks on the CI runner. A page paints, RR fires
  // one batched `/__manifest?paths=...` for every href in the DOM, and a click
  // on a row link then waits on a discovery promise that never settles: the
  // trace shows the click landing, `waitForURL` at dur=NEVER, and zero network
  // for the full 120s timeout — no route module, no `.data`, nothing. The nav
  // that works (/admin/products) gets a second, dedicated 3-path manifest
  // request; the ones that hang (/distribution/channels, /axis/policies) never
  // do, because the eager batch already marked their paths discovered.
  // Shipping the whole manifest with the document removes the moving part —
  // there is no discovery request left to lose. The manifest is ~130 routes of
  // metadata, not code; route modules still load on demand.
  routeDiscovery: { mode: "initial" }
} satisfies Config;
