import type { DurableObject as DurableObjectType } from "cloudflare:workers";

const { DurableObject } = (await import("cloudflare:workers").catch(
  () => import("./cloudflare-workers.stub.js")
)) as { DurableObject: typeof DurableObjectType };

interface Window {
  count: number;
  resetAt: number;
}

/**
 * docs/10 §2 RATE binding. One instance per throttle key (caller does
 * `env.RATE.idFromName(key)`), so the fixed window lives entirely in this
 * object — no key parameter needed on the RPC. Durable Object single-threading
 * per key removes the get-then-put race the old KV counter had (auth.ts).
 */
export class RateCounter extends DurableObject<unknown> {
  private window: Window | null = null;

  async hit(windowSec: number, now: number): Promise<{ count: number; resetAt: number }> {
    if (!this.window) {
      this.window = (await this.ctx.storage.get<Window>("window")) ?? null;
    }
    if (!this.window || this.window.resetAt <= now) {
      this.window = { count: 0, resetAt: now + windowSec * 1000 };
    }
    this.window.count += 1;
    await this.ctx.storage.put("window", this.window);
    return { count: this.window.count, resetAt: this.window.resetAt };
  }
}
