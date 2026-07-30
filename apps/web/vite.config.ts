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
  environments: {
    client: { build: { outDir: "build/client" } },
    ssr: { build: { outDir: "build/server" } }
  }
});
