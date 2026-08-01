import type { Env } from "../env.js";
import type { ChannelEvent } from "./user-channel.js";

/** One DO instance per actor, tenant-scoped so two tenants never share an id. */
function channelId(env: Env, tenantId: string, actorId: string) {
  return env.REALTIME!.idFromName(`${tenantId}:${actorId}`);
}

/** Push a live-update event to one actor's channel. No-op if REALTIME isn't bound. */
export async function pushToActor(
  env: Env,
  tenantId: string,
  actorId: string,
  type: string,
  data: unknown,
  now: number
): Promise<void> {
  if (!env.REALTIME) return;
  const stub = env.REALTIME.get(channelId(env, tenantId, actorId));
  await stub.push(type, data, now);
}

export async function pullForActor(
  env: Env,
  tenantId: string,
  actorId: string,
  sinceId: number
): Promise<ChannelEvent[]> {
  if (!env.REALTIME) return [];
  const stub = env.REALTIME.get(channelId(env, tenantId, actorId));
  return stub.pull(sinceId);
}
