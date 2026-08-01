import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ponytail: the only alias needed is the one bare specifier plain vitest can't
// resolve without @cloudflare/vitest-pool-workers — see
// src/engines/cloudflare-workers.stub.ts.
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./src/engines/cloudflare-workers.stub.ts", import.meta.url))
    }
  }
});
