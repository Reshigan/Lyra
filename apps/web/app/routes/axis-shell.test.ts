import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./axis-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("axis-shell loader", () => {
  it("returns the session when the actor's roles resolve to axis", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["axis"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/axis/board"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["axis"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to axis", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/axis/board"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
