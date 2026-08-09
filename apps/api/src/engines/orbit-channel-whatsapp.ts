import { hmacHex, timingSafeEqual, badRequest, unauthorized } from "@lyra/core";
import type {
  ChannelAdapter,
  ConnectorSecrets,
  DeliveryReceipt,
  InboundEvent,
  InboundMessage,
  OutboundMessage,
  VerifiedRequest
} from "@lyra/core";

interface WhatsAppMediaObject {
  readonly id: string;
  readonly mime_type: string;
  readonly caption?: string;
  readonly filename?: string;
}

interface WhatsAppMessage {
  readonly from: string;
  readonly id: string;
  readonly timestamp: string;
  readonly type: string;
  readonly text?: { readonly body: string };
  readonly image?: WhatsAppMediaObject;
  readonly video?: WhatsAppMediaObject;
  readonly audio?: WhatsAppMediaObject;
  readonly document?: WhatsAppMediaObject;
}

interface WhatsAppStatus {
  readonly id: string;
  readonly status: string;
  readonly timestamp: string;
  readonly errors?: ReadonlyArray<{ readonly title: string }>;
}

interface WhatsAppValue {
  readonly contacts?: ReadonlyArray<{ readonly wa_id: string; readonly profile: { readonly name: string } }>;
  readonly messages?: ReadonlyArray<WhatsAppMessage>;
  readonly statuses?: ReadonlyArray<WhatsAppStatus>;
}

interface WhatsAppWebhookPayload {
  readonly entry?: ReadonlyArray<{
    readonly changes?: ReadonlyArray<{ readonly value: WhatsAppValue }>;
  }>;
}

const MODALITY_MAP: Record<string, InboundMessage["modality"] | undefined> = {
  text: "text",
  image: "image",
  video: "video",
  audio: "voice",
  document: "document"
};

const STATUS_MAP: Record<string, DeliveryReceipt["status"] | undefined> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed"
};

function mediaOf(message: WhatsAppMessage) {
  const obj = message.image ?? message.video ?? message.audio ?? message.document;
  if (!obj) return undefined;
  return {
    providerId: obj.id,
    mime: obj.mime_type,
    ...(obj.filename !== undefined ? { filename: obj.filename } : {})
  };
}

function parseMessage(message: WhatsAppMessage, displayName: string | undefined): InboundEvent {
  const modality = MODALITY_MAP[message.type];
  if (!modality) return { kind: "ignored", why: `unsupported message type: ${message.type}` };
  const media = mediaOf(message);
  return {
    kind: "message",
    message: {
      externalRef: message.id,
      handle: message.from,
      ...(displayName !== undefined ? { displayName } : {}),
      text:
        message.text?.body ??
        message.image?.caption ??
        message.video?.caption ??
        message.document?.caption ??
        "",
      modality,
      ...(media ? { media: [media] } : {}),
      sentAt: Number(message.timestamp) * 1000
    }
  };
}

export const whatsappCloudAdapter: ChannelAdapter = {
  provider: "whatsapp-cloud-api",
  transport: "whatsapp",
  consentChannel: "whatsapp",

  challenge(req: VerifiedRequest, secrets: ConnectorSecrets): string | null {
    if (req.query.get("hub.mode") !== "subscribe") return null;
    if (req.query.get("hub.verify_token") !== secrets.verifyToken) return null;
    return req.query.get("hub.challenge");
  },

  async verify(req: VerifiedRequest, secrets: ConnectorSecrets): Promise<void> {
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature?.startsWith("sha256=")) throw unauthorized("missing whatsapp signature");
    if (secrets.appSecret === undefined) throw unauthorized("missing whatsapp app secret");
    const expected = await hmacHex(secrets.appSecret, req.rawBody);
    if (!timingSafeEqual(expected, signature.slice(7))) throw unauthorized("bad whatsapp signature");
  },

  parse(req: VerifiedRequest): InboundEvent[] {
    const payload = JSON.parse(req.rawBody) as WhatsAppWebhookPayload;
    const events: InboundEvent[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const message of value.messages ?? []) {
          const contact = value.contacts?.find((c) => c.wa_id === message.from);
          events.push(parseMessage(message, contact?.profile.name));
        }
        for (const status of value.statuses ?? []) {
          const mapped = STATUS_MAP[status.status];
          if (!mapped) continue;
          const errorTitle = status.errors?.[0]?.title;
          events.push({
            kind: "status",
            receipt: {
              externalRef: status.id,
              status: mapped,
              at: Number(status.timestamp) * 1000,
              ...(errorTitle !== undefined ? { error: errorTitle } : {})
            }
          });
        }
      }
    }
    return events;
  },

  async fetchMedia(providerId: string, secrets: ConnectorSecrets, config: Record<string, unknown>) {
    const version = (config.apiVersion as string | undefined) ?? "v20.0";
    const metaRes = await fetch(`https://graph.facebook.com/${version}/${providerId}`, {
      headers: { Authorization: `Bearer ${secrets.accessToken}` }
    });
    if (!metaRes.ok) throw badRequest(`whatsapp media lookup failed: ${metaRes.status}`);
    const meta = (await metaRes.json()) as { url: string; mime_type: string };
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${secrets.accessToken}` } });
    if (!fileRes.ok) throw badRequest(`whatsapp media download failed: ${fileRes.status}`);
    return { body: await fileRes.arrayBuffer(), mime: meta.mime_type };
  },

  async send(out: OutboundMessage, secrets: ConnectorSecrets, config: Record<string, unknown>) {
    const version = (config.apiVersion as string | undefined) ?? "v20.0";
    const phoneNumberId = config.phoneNumberId as string;
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secrets.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: out.to,
        type: "text",
        text: { body: out.text },
        ...(out.replyToExternalRef ? { context: { message_id: out.replyToExternalRef } } : {})
      })
    });
    if (!res.ok) throw badRequest(`whatsapp send failed: ${res.status}`);
    const json = (await res.json()) as { messages: ReadonlyArray<{ id: string }> };
    return { externalRef: json.messages[0]!.id };
  }
};
