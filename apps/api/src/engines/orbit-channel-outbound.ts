import { id, schema } from "@lyra/db";
import { assertChannel, badRequest, openFields, type ConnectorSecrets, type Ctx } from "@lyra/core";
import { fieldKey, type Env } from "../env.js";
import { adapterFor } from "./orbit-channel-adapters.js";

// The outbound half of the ChannelAdapter seam (ADR-0037/ADR-0038): resolve
// the conversation's connector, open its sealed secrets, hand the text to the
// provider, and only then record what was actually sent. Write-after-send is
// the point — a failed send must not leave a message row claiming "sent".

type ConversationRow = typeof schema.orbitConversations.$inferSelect;
type ConnectorRow = typeof schema.orbitChannelConnectors.$inferSelect;

export async function dispatchOutbound(
  ctx: Ctx,
  env: Env,
  conversation: ConversationRow,
  connector: ConnectorRow,
  text: string
): Promise<{ messageId: string; externalRef: string }> {
  if (!conversation.externalRef) throw badRequest("conversation has no channel address to reply to");

  const adapter = adapterFor(connector.provider);

  // docs/12 §2: every outbound send checks consent at runtime. `consentChannel`
  // is the seam that says which opt-in binds for this adapter (ADR-0038) —
  // `marketing: false` because a reply is a service message, so the channel
  // opt-in alone is enough and the marketing purpose is not required. A
  // conversation with no linked customer (a web widget before identification)
  // has nobody to check, and an adapter with a null consentChannel is one the
  // consent model has no channel for.
  if (conversation.customerId && adapter.consentChannel) {
    await assertChannel(ctx, conversation.customerId, adapter.consentChannel, { marketing: false });
  }

  const secrets = await openFields(fieldKey(env), JSON.parse(connector.secretsJson) as ConnectorSecrets);
  const config = JSON.parse(connector.configJson) as Record<string, unknown>;

  const sent = await adapter.send({ conversationId: conversation.id, to: conversation.externalRef, text }, secrets, config);

  const messageId = id("msg", ctx.now);
  await ctx.db.insert(schema.orbitMessages).values({
    id: messageId,
    tenantId: ctx.tenantId,
    conversationId: conversation.id,
    role: "agent_human",
    modality: "text",
    content: text,
    deliveryStatus: "sent",
    externalRef: sent.externalRef,
    ts: ctx.now
  });

  return { messageId, externalRef: sent.externalRef };
}
