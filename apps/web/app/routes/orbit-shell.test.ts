import { describe, expect, it, vi } from "vitest";

vi.mock("../session.server", () => ({
  bootstrapSession: vi.fn()
}));

vi.mock("../context", () => ({
  cloudflare: { toString: () => "cloudflare-context" }
}));

import { bootstrapSession } from "../session.server";
import { loader } from "./orbit-shell";

function fakeContext(env: unknown) {
  return { get: () => ({ env }) };
}

describe("orbit-shell loader", () => {
  it("returns the session when the actor's roles resolve to orbit", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["orbit"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/orbit/console"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["orbit"] });
  });

  it("throws 403 (not 401) when the actor's roles never resolve to orbit", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["north"]
    } as never);
    await expect(
      loader({
        request: new Request("https://lyra.test/orbit/console"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("still resolves availableShells to include axis for orbit.retention (ADR-0054)", async () => {
    vi.mocked(bootstrapSession).mockResolvedValue({
      availableShells: ["orbit", "axis"]
    } as never);
    const result = await loader({
      request: new Request("https://lyra.test/orbit/console"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({ availableShells: ["orbit", "axis"] });
  });
});
