import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The worker in workers/app.ts is the deploy target; the plugin runs the same
// workerd locally, so `pnpm dev` and production disagree about nothing.
//
// The Cloudflare plugin defaults its output to dist/<environment>; React Router
// builds and reads its manifest under build/. Pinning both environments here is
// what keeps `react-router build` and `wrangler deploy` looking in one place.
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tailwindcss(), reactRouter()],
  // LYRA_MODULES is a *build-time* flag (app/routing.ts's shouldInclude).
  // Neither bundle can read it at runtime — the browser has no `process`, and
  // workerd's `process.env` holds wrangler vars, not the build machine's
  // environment — so it is inlined here, once, for both.
  define: { "process.env.LYRA_MODULES": JSON.stringify(process.env.LYRA_MODULES ?? "all") },
  // "localhost" resolves to ::1 first on this box, so the dev server only ever
  // binds IPv6 — Playwright's webServer health check hits 127.0.0.1 explicitly
  // (e2e/env.ts) and times out against a port nothing IPv4 is listening on.
  // Vite compiles a route's module graph on first request, so the first visit
  // to a cold screen costs seconds — which on a two-core CI runner is what
  // pushed J-M2/J-M3 past their budgets inside `goto` (playwright.config.ts).
  // Warming the route files at server start moves that cost off the clock of
  // whichever test happened to arrive first.
  server: { host: "127.0.0.1", warmup: { clientFiles: ["./app/routes/*.tsx", "./app/root.tsx"] } },
  // radix-ui reaches the client only through packages/ui, so vite's scanner
  // misses it and optimizes it in a second pass — a reload mid-test on a cold
  // runner cache. Declaring it keeps the optimizer to one pass.
  // (An earlier note here blamed the CI navigation stalls on this producing two
  // React copies. It does not: rolldown-vite stamps a `?v=` hash per chunk
  // group, so several hashes in one page are normal and react/react-dom/
  // react-router all share one. The real cause was lazy route discovery — see
  // routeDiscovery in react-router.config.ts.)
  optimizeDeps: { include: ["radix-ui"] },
  environments: {
    client: { build: { outDir: "build/client" } },
    ssr: { build: { outDir: "build/server" } }
  }
});
