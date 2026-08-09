import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacHex } from "@lyra/core";
import { mailgunEmailAdapter } from "./orbit-channel-mailgun.js";

const secrets = { signingKey: "signing-key", apiKey: "api-key" };

async function fields(overrides: Record<string, string> = {}) {
  const timestamp = "1700000000";
  const token = "tok-1";
  const signature = await hmacHex(secrets.signingKey, `${timestamp}${token}`);
  return {
    sender: "customer@example.com",
    "body-plain": "Hi there",
    "Message-Id": "<msg-1@mail>",
    timestamp,
    token,
    signature,
    ...overrides
  };
}

function req(body: string) {
  return { rawBody: body, headers: new Headers(), query: new URLSearchParams() };
}

describe("mailgunEmailAdapter.verify", () => {
  it("accepts a correctly signed payload", async () => {
    const body = JSON.stringify(await fields());
    await expect(mailgunEmailAdapter.verify(req(body), secrets, Date.now())).resolves.toBeUndefined();
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify(await fields({ signature: "wrong" }));
    await expect(mailgunEmailAdapter.verify(req(body), secrets, Date.now())).rejects.toThrow();
  });
});

describe("mailgunEmailAdapter.parse", () => {
  it("parses the sender and body into an inbound message", async () => {
    const body = JSON.stringify(await fields());
    const events = mailgunEmailAdapter.parse(req(body));
    expect(events).toEqual([
      {
        kind: "message",
        message: {
          externalRef: "<msg-1@mail>",
          handle: "customer@example.com",
          text: "Hi there",
          modality: "text",
          sentAt: 1_700_000_000_000
        }
      }
    ]);
  });

  it("extracts an email address out of a display-name From header", async () => {
    const body = JSON.stringify(await fields({ from: "Amina <amina@example.com>", sender: "amina@example.com" }));
    const events = mailgunEmailAdapter.parse(req(body));
    const [event] = events;
    if (!event) throw new Error("expected mailgunEmailAdapter.parse to return one event");
    expect(event.kind === "message" && event.message.handle).toBe("amina@example.com");
  });
});

describe("mailgunEmailAdapter.send / fetchMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the Mailgun messages API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "<out-1@mail>" }), { status: 200 })));
    const result = await mailgunEmailAdapter.send(
      { conversationId: "cnv_1", to: "customer@example.com", text: "hi" },
      secrets,
      { domain: "mg.example.com", fromAddress: "support@example.com" }
    );
    expect(result).toEqual({ externalRef: "<out-1@mail>" });
  });

  it("throws when Mailgun rejects the send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(
      mailgunEmailAdapter.send({ conversationId: "cnv_1", to: "customer@example.com", text: "hi" }, secrets, {
        domain: "mg.example.com",
        fromAddress: "support@example.com"
      })
    ).rejects.toThrow();
  });

  it("downloads media with basic auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { "content-type": "image/png" } }))
    );
    const result = await mailgunEmailAdapter.fetchMedia("https://mg.example.com/attach/1", secrets, {});
    expect(result.mime).toBe("image/png");
    expect(new Uint8Array(result.body)).toEqual(new Uint8Array([9, 9]));
  });
});
