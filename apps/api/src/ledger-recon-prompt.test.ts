import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, describe, expect, it } from "vitest";
import { EntitlementsJson, PolicyJson } from "@lyra/db";
import { permissionsForRole, seed, type Ctx } from "@lyra/core";
import { Gateway, makeStub } from "@lyra/model-gateway";
import type { ReconCandidate, StatementLine } from "@lyra/ledger";
import { aiProposer } from "./routes/ledger.js";

// Reconciliation pass 3 asks the model to match "only when amount, date and
// reference agree". Dates were going over as raw epoch milliseconds, so ~1 in 10
// of them passed Luhn and scrub.ts replaced it with `[[CARD_1]]` before the
// provider saw it — measured at 29 of 400 candidates on a real run. The model was
// then asked to agree on a date it had been handed a redaction for, on the money
// path, where the failure is a wrong match rather than an obvious error.
//
// The ledger's own types stay numeric: the epoch value is right for arithmetic
// and storage, and only the prompt payload needs a renderable form.

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "packages", "db", "migrations");

/** 2026-06-16T01:00:00.000Z — an epoch instant that passes Luhn, i.e. one the scrubber eats. */
const LUHN_MS = 1_781_571_600_000;

let client: Client;
let ctx: Ctx;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  const statements = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(MIGRATIONS, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) await client.execute(sql);
  const db = drizzle(client) as unknown as Ctx["db"];
  const r = await seed(db, { password: "ledger-recon-prompt-2026" });
  ctx = {
    db,
    tenantId: r.tenantId,
    actor: {
      kind: "user",
      id: "u_1",
      tenantId: r.tenantId,
      grants: [{ roleKey: "finance.admin", permissions: permissionsForRole("finance.admin") }]
    },
    requestId: "req_1",
    now: Date.UTC(2026, 5, 20),
    locale: "en",
    policy: PolicyJson.parse({}),
    entitlements: EntitlementsJson.parse({})
  };
}, 120_000);

describe("recon pass 3 prompt payload", () => {
  it("sends posting dates the model can read, not epoch runs the scrubber eats", async () => {
    const stub = makeStub({ replies: ['{"matches":[]}'] });
    const gateway = new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });

    const lines: StatementLine[] = [{ ref: "ST-1", amountMinor: 125_000, currency: "AED", postedAt: LUHN_MS }];
    const candidates: ReconCandidate[] = [
      { txnId: "txn_1", type: "PREMIUM-RECEIPT", amountMinor: 125_000, currency: "AED", reference: "POL-1", postedAt: LUHN_MS }
    ];

    await aiProposer(ctx, gateway)(lines, candidates);

    // stub.calls records what the provider was handed — after the gateway scrubbed it.
    const sent = stub.calls[0]!.messages.at(-1)!.content;
    expect(sent, "an epoch posting date reached the scrubber and was redacted as a card number").not.toContain("[[CARD_");
    expect(sent.match(/2026-06-16T01:00:00\.000Z/g), "both sides of the comparison need a readable date").toHaveLength(2);
  });

  it("still asks for a match when a posting date is missing or unrenderable", async () => {
    // A statement line need not carry a date at all, and a candidate row can hold
    // a value no Date accepts. Neither may throw inside the proposer: the caller
    // (`reconcile`) would lose the whole pass, so every line comes back unmatched.
    const stub = makeStub({ replies: ['{"matches":[]}'] });
    const gateway = new Gateway({ env: {}, providers: { "workers-ai": stub, anthropic: stub, "openai-compat": stub } });

    const lines: StatementLine[] = [{ ref: "ST-2", amountMinor: 1, currency: "AED" }];
    const candidates: ReconCandidate[] = [
      { txnId: "txn_2", type: "PREMIUM-RECEIPT", amountMinor: 1, currency: "AED", reference: "POL-2", postedAt: 9e15 }
    ];

    await expect(aiProposer(ctx, gateway)(lines, candidates)).resolves.toEqual([]);
    const sent = stub.calls[0]!.messages.at(-1)!.content;
    expect(sent).toContain("unknown");
  });
});
