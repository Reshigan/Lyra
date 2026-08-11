import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@lyra/core";
import { SITEVERIFY_URL, verifyTurnstile } from "./turnstile.js";
import type { Env } from "./env.js";

const configured = { TURNSTILE_SECRET: "1x0000000000000000000000000000000AA" } as unknown as Env;

function stubFetch(payload: unknown, status = 200) {
  const spy = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("does nothing when no secret is bound — a dev/on-prem deployment has no widget to answer", async () => {
    const spy = stubFetch({ success: true });
    await expect(verifyTurnstile({} as Env, undefined)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a missing token once the secret is bound rather than letting the form through", async () => {
    const spy = stubFetch({ success: true });
    await expect(verifyTurnstile(configured, undefined)).rejects.toMatchObject({ status: 403 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts secret + response to siteverify and passes on success", async () => {
    const spy = stubFetch({ success: true });
    await expect(verifyTurnstile(configured, "tok", "203.0.113.7")).resolves.toBeUndefined();
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    const sent = init.body as FormData;
    expect(sent.get("secret")).toBe("1x0000000000000000000000000000000AA");
    expect(sent.get("response")).toBe("tok");
    expect(sent.get("remoteip")).toBe("203.0.113.7");
  });

  it("refuses when siteverify says the token is bad", async () => {
    stubFetch({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstile(configured, "tok")).rejects.toBeInstanceOf(AppError);
  });

  it("fails closed when siteverify itself is unreachable — never open on an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await expect(verifyTurnstile(configured, "tok")).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed on a non-2xx from siteverify", async () => {
    stubFetch({}, 502);
    await expect(verifyTurnstile(configured, "tok")).rejects.toMatchObject({ status: 403 });
  });
});
