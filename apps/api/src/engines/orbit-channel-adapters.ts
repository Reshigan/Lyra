import { badRequest } from "@lyra/core";
import type { ChannelAdapter } from "@lyra/core";
import { whatsappCloudAdapter } from "./orbit-channel-whatsapp.js";
import { mailgunEmailAdapter } from "./orbit-channel-mailgun.js";

const ADAPTERS: Record<string, ChannelAdapter> = {
  [whatsappCloudAdapter.provider]: whatsappCloudAdapter,
  [mailgunEmailAdapter.provider]: mailgunEmailAdapter
};

export function adapterFor(provider: string): ChannelAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw badRequest(`unknown channel provider: ${provider}`);
  return adapter;
}
