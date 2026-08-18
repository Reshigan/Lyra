import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./signal-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("signal-shell loader", () => {
  it("returns the session when the actor's roles resolve to signal", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["signal"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/signal/cockpit"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["signal"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to signal", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/signal/cockpit"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
