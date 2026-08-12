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
  // misses it and optimizes it in a second pass with a fresh browserHash. The
  // page then holds two generations at once —
  //   deps/radix-ui.js?v=3e9e5c5c  next to  deps/react-dom.js?v=8aff3b7b
  // — which means two React copies, so the RouterContext a <Link> reads is not
  // the one the mounted router provides. Clicking such a link fires no
  // navigation, no request and no error; the test just waits out its timeout,
  // and every retry hits the same server. That is CI run 31627230986 (four
  // attempts, same three journeys). Declaring the dep pins one generation.
  optimizeDeps: { include: ["radix-ui"] },
  environments: {
    client: { build: { outDir: "build/client" } },
    ssr: { build: { outDir: "build/server" } }
  }
});
