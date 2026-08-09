import { hmacHex, timingSafeEqual, badRequest, unauthorized } from "@lyra/core";
import type { ChannelAdapter, ConnectorSecrets, InboundEvent, OutboundMessage, VerifiedRequest } from "@lyra/core";

interface MailgunFields {
  readonly sender: string;
  readonly from?: string;
  readonly "body-plain": string;
  readonly "Message-Id": string;
  readonly timestamp: string;
  readonly token: string;
  readonly signature: string;
}

function handleOf(fields: MailgunFields): string {
  const match = fields.from?.match(/<([^>]+)>/);
  return match ? match[1]! : fields.sender;
}

export const mailgunEmailAdapter: ChannelAdapter = {
  provider: "mailgun-email",
  transport: "email",
  consentChannel: "email",

  async verify(req: VerifiedRequest, secrets: ConnectorSecrets): Promise<void> {
    if (secrets.signingKey === undefined) throw unauthorized("missing mailgun signing key");
    let fields: MailgunFields;
    try {
      fields = JSON.parse(req.rawBody) as MailgunFields;
    } catch {
      throw unauthorized("malformed mailgun payload");
    }
    const expected = await hmacHex(secrets.signingKey, `${fields.timestamp}${fields.token}`);
    if (!timingSafeEqual(expected, fields.signature)) throw unauthorized("bad mailgun signature");
  },

  parse(req: VerifiedRequest): InboundEvent[] {
    const fields = JSON.parse(req.rawBody) as MailgunFields;
    return [
      {
        kind: "message",
        message: {
          externalRef: fields["Message-Id"],
          handle: handleOf(fields),
          text: fields["body-plain"],
          modality: "text",
          sentAt: Number(fields.timestamp) * 1000
        }
      }
    ];
  },

  async fetchMedia(providerId: string, secrets: ConnectorSecrets) {
    const res = await fetch(providerId, {
      headers: { Authorization: `Basic ${btoa(`api:${secrets.apiKey}`)}` }
    });
    if (!res.ok) throw badRequest(`mailgun media download failed: ${res.status}`);
    return { body: await res.arrayBuffer(), mime: res.headers.get("content-type") ?? "application/octet-stream" };
  },

  async send(out: OutboundMessage, secrets: ConnectorSecrets, config: Record<string, unknown>) {
    const domain = config.domain as string;
    const fromAddress = config.fromAddress as string;
    const form = new URLSearchParams({ from: fromAddress, to: out.to, subject: "Re: your message", text: out.text });
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${secrets.apiKey}`)}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: form
    });
    if (!res.ok) throw badRequest(`mailgun send failed: ${res.status}`);
    const json = (await res.json()) as { id: string };
    return { externalRef: json.id };
  }
};
