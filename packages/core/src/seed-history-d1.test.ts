import { describe, expect, it, vi } from "vitest";
import { d1Endpoint, d1Proxy, parseArgs, pickTenant } from "./seed-history-d1.js";

describe("parseArgs", () => {
  it("reads the flags the seeder needs", () => {
    expect(parseArgs(["--database", "db_1", "--days", "30", "--tenant", "ten_1"])).toEqual({
      database: "db_1",
      days: 30,
      tenant: "ten_1"
    });
  });

  it("defaults to a year, because that is what the demo's rolling windows read", () => {
    expect(parseArgs(["--database", "db_1"])).toEqual({ database: "db_1", days: 365, tenant: undefined });
  });

  it("refuses to run without a database rather than guessing at one", () => {
    // Guessing here would seed whichever database the token happens to reach.
    expect(() => parseArgs([])).toThrow(/--database/);
    expect(() => parseArgs(["--database", ""])).toThrow(/--database/);
  });

  it("treats an empty --tenant as absent, so the single-tenant lookup still runs", () => {
    expect(parseArgs(["--database", "db_1", "--tenant", ""]).tenant).toBeUndefined();
  });

  it("takes the flags in pairs and ignores the order they arrive in", () => {
    expect(parseArgs(["--days", "7", "--database", "db_1"])).toEqual({
      database: "db_1",
      days: 7,
      tenant: undefined
    });
  });

  it("tolerates a trailing flag with no value", () => {
    // `--tenant` with nothing after it is a typo, not a request to seed every
    // tenant: it reads as absent and the single-tenant guard below catches it.
    expect(parseArgs(["--database", "db_1", "--tenant"]).tenant).toBeUndefined();
  });
});

describe("pickTenant", () => {
  const rows = [
    { id: "ten_1", slug: "gonxt" },
    { id: "ten_2", slug: "acme" }
  ];

  it("uses the tenant that was asked for, without reading the table", () => {
    expect(pickTenant(rows, "ten_2")).toBe("ten_2");
  });

  it("infers the tenant only when there is exactly one to infer", () => {
    expect(pickTenant([rows[0]!], undefined)).toBe("ten_1");
  });

  it("names the candidates instead of picking one, when there is a choice", () => {
    // Seeding a year of trading history into the wrong tenant is not something
    // a re-run undoes, so ambiguity stops the CLI and prints the ids to choose from.
    expect(() => pickTenant(rows, undefined)).toThrow(/gonxt=ten_1/);
    expect(() => pickTenant(rows, undefined)).toThrow(/acme=ten_2/);
    expect(() => pickTenant(rows, undefined)).toThrow(/2 tenants/);
  });

  it("stops on an empty database rather than seeding nothing and reporting success", () => {
    expect(() => pickTenant([], undefined)).toThrow(/0 tenants/);
  });
});

describe("d1Endpoint", () => {
  it("addresses /raw, not /query", () => {
    // `/query` answers with objects; sqlite-proxy wants positional rows and
    // would read every column as undefined against the other shape.
    expect(d1Endpoint("acc_1", "db_1")).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc_1/d1/database/db_1/raw"
    );
  });
});

describe("d1Proxy", () => {
  const ok = (rows: unknown[][]) =>
    ({
      ok: true,
      json: async () => ({ success: true, result: [{ results: { rows } }] })
    }) as unknown as Response;

  it("posts the statement with the token in the header, never in the query", () => {
    const fetchImpl = vi.fn(async () => ok([]));
    const proxy = d1Proxy("https://d1.example/raw", "tok_secret", fetchImpl as unknown as typeof fetch);

    return proxy("select 1", [7], "all").then(() => {
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://d1.example/raw");
      expect(url).not.toContain("tok_secret");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok_secret");
      expect(init.body).toBe(JSON.stringify({ sql: "select 1", params: [7] }));
    });
  });

  it("hands back every row for a multi-row read", async () => {
    const proxy = d1Proxy("u", "t", (async () => ok([["a"], ["b"]])) as unknown as typeof fetch);
    expect(await proxy("select", [], "all")).toEqual({ rows: [["a"], ["b"]] });
  });

  it("hands back the first row for a `get`, and an empty row when there is none", async () => {
    const two = d1Proxy("u", "t", (async () => ok([["a"], ["b"]])) as unknown as typeof fetch);
    expect(await two("select", [], "get")).toEqual({ rows: ["a"] });

    const none = d1Proxy("u", "t", (async () => ok([])) as unknown as typeof fetch);
    expect(await none("select", [], "get")).toEqual({ rows: [] });
  });

  it("reads a response with no result block as no rows, not as a crash", async () => {
    const bare = { ok: true, json: async () => ({ success: true }) } as unknown as Response;
    const proxy = d1Proxy("u", "t", (async () => bare) as unknown as typeof fetch);
    expect(await proxy("select", [], "all")).toEqual({ rows: [] });
  });

  it("raises D1's own message, which is the only part that names the fault", async () => {
    const bad = {
      ok: false,
      status: 400,
      json: async () => ({ success: false, errors: [{ message: "UNIQUE constraint failed" }, { message: "and again" }] })
    } as unknown as Response;
    const proxy = d1Proxy("u", "t", (async () => bad) as unknown as typeof fetch);
    await expect(proxy("insert", [], "run")).rejects.toThrow("D1: UNIQUE constraint failed; and again");
  });

  it("falls back to the status only when D1 said nothing", async () => {
    const bad = { ok: false, status: 403, json: async () => ({ success: false }) } as unknown as Response;
    const proxy = d1Proxy("u", "t", (async () => bad) as unknown as typeof fetch);
    await expect(proxy("insert", [], "run")).rejects.toThrow("D1: 403");
  });

  it("treats a 200 that reports success: false as a failure", async () => {
    // D1 answers 200 with `success: false` for a statement-level error; reading
    // only the HTTP status would seed a partial year and report it as done.
    const bad = {
      ok: true,
      status: 200,
      json: async () => ({ success: false, errors: [{ message: "no such table: core_tenants" }] })
    } as unknown as Response;
    const proxy = d1Proxy("u", "t", (async () => bad) as unknown as typeof fetch);
    await expect(proxy("select", [], "all")).rejects.toThrow("D1: no such table: core_tenants");
  });
});
