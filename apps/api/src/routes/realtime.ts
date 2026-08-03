import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Ctx } from "@lyra/core";
import { intParam } from "../http.js";
import { pullForActor } from "../engines/realtime.js";
import type { App } from "../env.js";

// docs/04 §5 / docs/10 §2: ambient AI grammar (docs/15) needs a live channel for
// quiet chips — "your export is ready" — without a modal or a page reload.
// SSE, not WebSocket: REALTIME.pull() is poll-shaped already, and Workers'
// WebSocket hibernation API is a bigger seam than one notification stream needs.
export const realtimeRoutes = new Hono<App>();

const ctxOf = (c: { get(k: "ctx"): Ctx }): Ctx => c.get("ctx");
const POLL_MS = 3000;

realtimeRoutes.get("/", async (c) => {
  const ctx = ctxOf(c);
  const env = c.env;
  let sinceId = intParam(c.req.query("since"), -1, { min: -1 });

  return streamSSE(c, async (stream) => {
    while (!stream.aborted) {
      const events = await pullForActor(env, ctx.tenantId, ctx.actor.id, sinceId);
      for (const event of events) {
        await stream.writeSSE({ id: String(event.id), event: event.type, data: JSON.stringify(event.data) });
        sinceId = event.id;
      }
      await stream.sleep(POLL_MS);
    }
  });
});
