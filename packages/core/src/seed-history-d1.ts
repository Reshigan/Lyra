// The testable half of seed-history-cli.ts: argument parsing, tenant resolution
// and the D1 HTTP transport. It lives here rather than in the entrypoint because
// an entrypoint that runs on import cannot be unit-tested, and this is the only
// path that writes a year of history into a deployed database — the arithmetic
// of "which database, which tenant, did the write actually succeed" is worth a
// gate. seed-history-cli.ts keeps only the env reads and the two seeder calls.

export interface HistoryArgs {
  database: string;
  days: number;
  tenant?: string | undefined;
}

export function parseArgs(argv: string[]): HistoryArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) flags.set(argv[i]!.replace(/^--/, ""), argv[i + 1] ?? "");
  const database = flags.get("database");
  if (!database) throw new Error("seed:history: --database <d1-database-id> is required");
  return { database, days: Number(flags.get("days") ?? 365), tenant: flags.get("tenant") || undefined };
}

// Seeding a year of trading history into the wrong tenant is not something a
// re-run undoes, so this infers a tenant only when there is exactly one to infer
// and otherwise prints the ids to choose between.
export function pickTenant(tenants: { id: string; slug: string }[], requested: string | undefined): string {
  if (requested) return requested;
  if (tenants.length !== 1) {
    throw new Error(
      `seed:history: ${tenants.length} tenants in this database — pass --tenant (${tenants.map((t) => `${t.slug}=${t.id}`).join(", ")})`
    );
  }
  return tenants[0]!.id;
}

// `/raw` answers with positional rows, which is the shape sqlite-proxy wants;
// `/query` answers with objects and would silently produce undefined columns.
export function d1Endpoint(accountId: string, databaseId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`;
}

interface D1Response {
  success: boolean;
  errors?: { message: string }[];
  result?: { results?: { rows?: unknown[][] } }[];
}

/** The drizzle sqlite-proxy callback, over D1's HTTP API. */
export function d1Proxy(
  endpoint: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): (sql: string, params: unknown[], method: string) => Promise<{ rows: unknown[] }> {
  return async (sql, params, method) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params })
    });
    const body = (await response.json()) as D1Response;
    // D1 answers 200 with `success: false` for a statement-level error, so the
    // status alone would seed a partial year and report it as done. Its own
    // message names the constraint or the parameter count; the status never does.
    if (!response.ok || !body.success) {
      throw new Error(`D1: ${body.errors?.map((e) => e.message).join("; ") ?? response.status}`);
    }
    const rows = body.result?.[0]?.results?.rows ?? [];
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  };
}
