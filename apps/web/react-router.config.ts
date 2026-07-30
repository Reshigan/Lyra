import type { Config } from "@react-router/dev/config";

export default {
  // SSR on: the shell paints from /v1/me on the server, so the first frame
  // already knows the actor, their nav and their locale (docs/15 §2).
  ssr: true
} satisfies Config;
