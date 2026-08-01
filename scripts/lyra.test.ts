import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "./lyra.js";
import { onpremInit, onpremMigrate, onpremSeed, onpremSmoke } from "./lyra-onprem.js";

// ------------------------------------------------------------- dispatch/argv

describe("dispatch (argv parsing)", () => {
  it("rejects a command that isn't onprem", async () => {
    const result = await dispatch(["nope"]);
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/unknown command "nope"/);
  });

  it("rejects an unknown onprem subcommand", async () => {
    const result = await dispatch(["onprem", "bogus"]);
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/unknown onprem subcommand "bogus"/);
  });

  it("reports usage when no subcommand is given", async () => {
    const result = await dispatch(["onprem"]);
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/unknown onprem subcommand/);
  });
});

// ------------------------------------------------------------------- init

describe("onpremInit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lyra-cli-init-"));
    writeFileSync(
      join(dir, ".env.example"),
      ["AUTH_SECRET=generate-a-long-random-string", "MINIO_ROOT_PASSWORD=REPLACE_ME_MIN_8_CHARS", "RENDER_TOKEN=REPLACE_ME", "LYRA_LICENCE=", "APP_ORIGIN=http://localhost:5173"].join(
        "\n"
      )
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes ops/.env with generated secrets on a fresh install", () => {
    const result = onpremInit({ root: dir });
    expect(result.created).toBe(true);
    expect(result.generated.sort()).toEqual(["AUTH_SECRET", "MINIO_ROOT_PASSWORD", "RENDER_TOKEN"]);
    expect(result.licenceConfigured).toBe(false);
    expect(existsSync(join(dir, "ops/.env"))).toBe(true);

    const written = readFileSync(join(dir, "ops/.env"), "utf8");
    expect(written).not.toMatch(/generate-a-long-random-string/);
    expect(written).not.toMatch(/REPLACE_ME/);
    expect(written).toMatch(/APP_ORIGIN=http:\/\/localhost:5173/);
  });

  it("is idempotent — never overwrites an existing ops/.env", () => {
    mkdirSync(join(dir, "ops"), { recursive: true });
    writeFileSync(join(dir, "ops/.env"), "AUTH_SECRET=already-set\n");

    const result = onpremInit({ root: dir });
    expect(result.created).toBe(false);
    expect(result.generated).toEqual([]);
    expect(readFileSync(join(dir, "ops/.env"), "utf8")).toBe("AUTH_SECRET=already-set\n");
  });
});

// ---------------------------------------------------------- migrate / seed

describe("onpremMigrate", () => {
  it("wraps the existing drizzle-kit migrate command with LIBSQL_URL translated to DATABASE_URL", () => {
    const exec = vi.fn();
    onpremMigrate({ exec, env: { LIBSQL_URL: "http://libsql:8080", LIBSQL_AUTH_TOKEN: "tok" } });

    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = exec.mock.calls[0]!;
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["--filter", "@lyra/db", "migrate"]);
    expect(opts.env.LIBSQL_URL).toBe("http://libsql:8080");
    expect(opts.env.DATABASE_URL).toBe("http://libsql:8080");
  });

  it("defaults LIBSQL_URL to an absolute path under the given root when unset", () => {
    const exec = vi.fn();
    onpremMigrate({ exec, env: {}, root: "/repo" });
    const opts = exec.mock.calls[0]![2];
    expect(opts.env.LIBSQL_URL).toBe("file:/repo/.data/lyra.db");
  });
});

describe("onpremSeed", () => {
  it("wraps the existing core seed script and maps LIBSQL_URL -> DATABASE_URL", () => {
    const exec = vi.fn();
    onpremSeed({ exec, env: { LIBSQL_URL: "http://libsql:8080", LIBSQL_AUTH_TOKEN: "tok" } });

    const [cmd, args, opts] = exec.mock.calls[0]!;
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["--filter", "@lyra/core", "seed"]);
    expect(opts.env.DATABASE_URL).toBe("http://libsql:8080");
    expect(opts.env.DATABASE_AUTH_TOKEN).toBe("tok");
  });

  it("passes an explicit password through as SEED_PASSWORD", () => {
    const exec = vi.fn();
    onpremSeed({ exec, env: {}, password: "Sup3r-Secret!" });
    const opts = exec.mock.calls[0]![2];
    expect(opts.env.SEED_PASSWORD).toBe("Sup3r-Secret!");
  });
});

// ------------------------------------------------------------------- smoke

describe("onpremSmoke", () => {
  it("reports each tier's reachability independently and completes a round trip on the reachable chat tier", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("11434") && u.endsWith("/models")) {
        return jsonResponse(200, { data: [{ id: "qwen2.5:3b-instruct" }] });
      }
      if (u.includes("11434") && u.endsWith("/chat/completions")) {
        return jsonResponse(200, {
          choices: [{ message: { content: "Ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 1 }
        });
      }
      // vLLM and TEI are not running in this environment.
      throw new Error("connect ECONNREFUSED");
    });

    const report = await onpremSmoke({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { OPENAI_COMPAT_URL: "http://localhost:11434/v1" }
    });

    const llm = report.tiers.find((t) => t.service === "llm")!;
    const vllm = report.tiers.find((t) => t.service === "llm-vllm")!;
    const embed = report.tiers.find((t) => t.service === "embed")!;
    expect(llm.reachable).toBe(true);
    expect(vllm.reachable).toBe(false);
    expect(embed.reachable).toBe(false);
    expect(report.roundTrip?.ok).toBe(true);
    expect(report.roundTrip?.model).toBe("qwen2.5:3b-instruct");
    expect(report.roundTrip?.text).toBe("Ok");
  });

  it("skips the round trip and says so when no chat tier is reachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const report = await onpremSmoke({ fetchImpl: fetchImpl as unknown as typeof fetch, env: {} });

    expect(report.tiers.every((t) => !t.reachable)).toBe(true);
    expect(report.roundTrip).toBeNull();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
