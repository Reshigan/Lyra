import { describe, expect, it, vi } from "vitest";

const bootstrapSession = vi.fn();
vi.mock("../session.server", () => ({ bootstrapSession }));

function fakeContext(env: Record<string, unknown>) {
  return { get: () => ({ env }) } as never;
}

describe("scout-shell loader", () => {
  it("returns session when roles resolve to scout", async () => {
    bootstrapSession.mockResolvedValueOnce({
      availableShells: ["scout"],
      brand: { name: "Test" }
    });
    const { loader } = await import("./scout-shell");
    const result = await loader({
      request: new Request("https://lyra.test/scout/radar"),
      context: fakeContext({})
    } as never);
    expect(result).toEqual({
      availableShells: ["scout"],
      brand: { name: "Test" }
    });
  });

  it("throws 403 not 401 when roles don't resolve to scout", async () => {
    bootstrapSession.mockResolvedValueOnce({
      availableShells: ["north"],
      brand: { name: "Test" }
    });
    const { loader } = await import("./scout-shell");
    await expect(
      loader({
        request: new Request("https://lyra.test/scout/radar"),
        context: fakeContext({})
      } as never)
    ).rejects.toMatchObject({ init: { status: 403 } });
  });
});
