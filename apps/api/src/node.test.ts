import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("on-prem boot", () => {
  // vitest.config.ts aliases the bare specifier "cloudflare:workers" to a stub
  // for its own module runner (see cloudflare-workers.stub.ts) — that alias
  // does not exist for plain Node, so every test above loads engines/agent-room.ts
  // through the alias and would never notice if it broke real `tsx src/node.ts`
  // boot (docs/11 §3, the actual on-prem/Docker entrypoint). Spawn the real
  // entrypoint as a child process to catch that regression:
  // ERR_UNSUPPORTED_ESM_URL_SCHEME on the bare "cloudflare:workers" import.
  it("boots under plain tsx and answers /health", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyra-node-boot-"));
    const filesDir = await mkdtemp(join(tmpdir(), "lyra-node-files-"));
    const port = 34000 + Math.floor(Math.random() * 4000);
    const entry = fileURLToPath(new URL("./node.ts", import.meta.url));
    const tsxBin = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

    // ponytail: spawn the local tsx bin directly rather than `pnpm exec tsx`
    // — one less process hop, so this stays well inside its timeout even
    // when the whole suite is running in parallel under load.
    const child = spawn(tsxBin, [entry], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        LIBSQL_URL: `file:${join(dataDir, "lyra.db")}`,
        FILES_DIR: filesDir,
        PORT: String(port)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk) => (output += chunk.toString()));

    try {
      const deadline = Date.now() + 45_000;
      let res: Response | undefined;
      while (Date.now() < deadline) {
        if (output.includes("ERR_UNSUPPORTED_ESM_URL_SCHEME")) {
          throw new Error(`node.ts crashed on boot:\n${output}`);
        }
        try {
          res = await fetch(`http://127.0.0.1:${port}/health`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      expect(res, `server never answered /health; output so far:\n${output}`).toBeDefined();
      expect(res!.status).toBe(200);
      expect(await res!.json()).toMatchObject({ ok: true });
    } finally {
      child.kill();
    }
  }, 50_000);
});
