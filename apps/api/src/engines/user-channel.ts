import type { DurableObject as DurableObjectType } from "cloudflare:workers";

const { DurableObject } = (await import("cloudflare:workers").catch(
  () => import("./cloudflare-workers.stub.js")
)) as { DurableObject: typeof DurableObjectType };

export interface ChannelEvent {
  id: number;
  type: string;
  data: unknown;
  ts: number;
}

export interface ChannelState {
  nextId: number;
  /** ponytail: ring buffer, not a queue — SSE readers poll `pull(sinceId)`, they
   * don't need delivery guarantees a real queue gives; last 200 is plenty to
   * survive a reconnect. */
  recent: ChannelEvent[];
}

const MAX_RECENT = 200;

export function emptyChannel(): ChannelState {
  return { nextId: 0, recent: [] };
}

export function appendEvent(state: ChannelState, type: string, data: unknown, now: number): ChannelState {
  const event: ChannelEvent = { id: state.nextId, type, data, ts: now };
  const recent = [...state.recent, event].slice(-MAX_RECENT);
  return { nextId: state.nextId + 1, recent };
}

export function pullSince(state: ChannelState, sinceId: number): ChannelEvent[] {
  return state.recent.filter((e) => e.id > sinceId);
}

/**
 * docs/04 §5 / docs/10 §2 REALTIME binding — one instance per user. `push`
 * is called by anything that wants to notify a user (NORTH anomaly/briefing
 * ticks, approvals, etc); `pull` is polled by the SSE route in
 * routes/realtime.ts. WebSocket upgrade is the upgrade path once a client
 * needs push latency below the SSE poll interval — not built until a caller
 * needs it.
 */
export class UserChannel extends DurableObject<unknown> {
  private state: ChannelState | null = null;

  private async load(): Promise<ChannelState> {
    if (!this.state) {
      this.state = (await this.ctx.storage.get<ChannelState>("state")) ?? emptyChannel();
    }
    return this.state;
  }

  async push(type: string, data: unknown, now: number): Promise<{ id: number }> {
    const next = appendEvent(await this.load(), type, data, now);
    this.state = next;
    await this.ctx.storage.put("state", next);
    return { id: next.nextId - 1 };
  }

  async pull(sinceId: number): Promise<ChannelEvent[]> {
    return pullSince(await this.load(), sinceId);
  }
}
