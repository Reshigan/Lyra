import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacHex } from "@lyra/core";
import { whatsappCloudAdapter } from "./orbit-channel-whatsapp.js";

const secrets = { appSecret: "app-secret", verifyToken: "verify-me", accessToken: "token-123" };

async function signedRequest(body: string) {
  const signature = `sha256=${await hmacHex(secrets.appSecret, body)}`;
  return { rawBody: body, headers: new Headers({ "x-hub-signature-256": signature }), query: new URLSearchParams() };
}

describe("whatsappCloudAdapter.challenge", () => {
  it("echoes hub.challenge when the verify token matches", () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-me",
      "hub.challenge": "123"
    });
    const result = whatsappCloudAdapter.challenge!({ rawBody: "", headers: new Headers(), query }, secrets);
    expect(result).toBe("123");
  });

  it("returns null when the verify token is wrong", () => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "123"
    });
    const result = whatsappCloudAdapter.challenge!({ rawBody: "", headers: new Headers(), query }, secrets);
    expect(result).toBeNull();
  });
});

describe("whatsappCloudAdapter.verify", () => {
  it("accepts a correctly signed body", async () => {
    const req = await signedRequest('{"entry":[]}');
    await expect(whatsappCloudAdapter.verify(req, secrets, Date.now())).resolves.toBeUndefined();
  });

  it("throws on a bad signature", async () => {
    const req = {
      rawBody: '{"entry":[]}',
      headers: new Headers({ "x-hub-signature-256": "sha256=bad" }),
      query: new URLSearchParams()
    };
    await expect(whatsappCloudAdapter.verify(req, secrets, Date.now())).rejects.toThrow();
  });
});

const TEXT_PAYLOAD = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ wa_id: "97150", profile: { name: "Amina" } }],
            messages: [
              { from: "97150", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Hello" } }
            ]
          }
        }
      ]
    }
  ]
});

describe("whatsappCloudAdapter.parse", () => {
  it("parses a text message", () => {
    const events = whatsappCloudAdapter.parse({
      rawBody: TEXT_PAYLOAD,
      headers: new Headers(),
      query: new URLSearchParams()
    });
    expect(events).toEqual([
      {
        kind: "message",
        message: {
          externalRef: "wamid.1",
          handle: "97150",
          displayName: "Amina",
          text: "Hello",
          modality: "text",
          media: undefined,
          sentAt: 1_700_000_000_000
        }
      }
    ]);
  });

  it("marks an unsupported message type as ignored", () => {
    const payload = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: "97150", id: "wamid.2", timestamp: "1700000000", type: "sticker" }] } }] }]
    });
    const events = whatsappCloudAdapter.parse({
      rawBody: payload,
      headers: new Headers(),
      query: new URLSearchParams()
    });
    expect(events).toEqual([{ kind: "ignored", why: "unsupported message type: sticker" }]);
  });

  it("parses a delivery status receipt", () => {
    const payload = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000100" }] } }] }]
    });
    const events = whatsappCloudAdapter.parse({
      rawBody: payload,
      headers: new Headers(),
      query: new URLSearchParams()
    });
    expect(events).toEqual([
      { kind: "status", receipt: { externalRef: "wamid.1", status: "delivered", at: 1_700_000_100_000, error: undefined } }
    ]);
  });
});

describe("whatsappCloudAdapter.send / fetchMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a text message to the Graph API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out.1" }] }), { status: 200 }))
    );
    const result = await whatsappCloudAdapter.send(
      { conversationId: "cnv_1", to: "97150", text: "hi" },
      secrets,
      { phoneNumberId: "pn_1" }
    );
    expect(result).toEqual({ externalRef: "wamid.out.1" });
  });

  it("throws when the Graph API rejects the send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 400 })));
    await expect(
      whatsappCloudAdapter.send({ conversationId: "cnv_1", to: "97150", text: "hi" }, secrets, { phoneNumberId: "pn_1" })
    ).rejects.toThrow();
  });

  it("fetches media in two steps", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://lookaside.example/file", mime_type: "image/jpeg" }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await whatsappCloudAdapter.fetchMedia("media_1", secrets, {});
    expect(result.mime).toBe("image/jpeg");
    expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
