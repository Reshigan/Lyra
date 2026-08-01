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
  server: { host: "127.0.0.1" },
  environments: {
    client: { build: { outDir: "build/client" } },
    ssr: { build: { outDir: "build/server" } }
  }
});
