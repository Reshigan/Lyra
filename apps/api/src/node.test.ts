import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { files, kv } from "./node.js";

// The two on-prem stand-ins are the only hand-written behaviour in node.ts —
// everything else is the same handlers the journey suite already walks. These
// pin the three things that would fail silently in production: a TTL that
// never expires (login throttle jams at 8), a get/put round trip that loses
// bytes (every analytics export lands in state "failed"), and a key that
// escapes the volume root.

describe("kv adapter", () => {
  it("round-trips and expires on the ttl", async () => {
    const store = kv();
    expect(await store.get("login:a")).toBeNull();

    await store.put("login:a", "3", { expirationTtl: 300 });
    expect(await store.get("login:a")).toBe("3");

    await store.put("login:b", "1", { expirationTtl: 0 });
    expect(await store.get("login:b")).toBeNull();
  });
});

describe("files adapter", () => {
  it("round-trips bytes through a nested key", async () => {
    const root = await mkdtemp(join(tmpdir(), "lyra-files-"));
    const bucket = files(root);
    const bytes = new TextEncoder().encode("board pack");

    expect(await bucket.get("exports/t_1/exp_1.pdf")).toBeNull();

    await bucket.put("exports/t_1/exp_1.pdf", bytes);
    expect(await readFile(join(root, "exports/t_1/exp_1.pdf"), "utf8")).toBe("board pack");

    const object = await bucket.get("exports/t_1/exp_1.pdf");
    expect(await new Response(object?.body).text()).toBe("board pack");
  });

  it("refuses a key that escapes the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lyra-files-"));
    const bucket = files(root);
    await expect(bucket.put("../escape", new Uint8Array([1]))).rejects.toThrow(/invalid object key/);
    // `get` swallows read errors to return null, so the guard is asserted on
    // the write path — the one that could clobber a file outside the volume.
  });
});
