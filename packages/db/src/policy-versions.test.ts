import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { policyVersionViolations, type PolicyVersionRow } from "./policy-versions.js";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const DAY = 86_400_000;
const T0 = 1_767_225_600_000; // 2026-01-01

function version(over: Partial<PolicyVersionRow> & { versionSeq: number }): PolicyVersionRow {
  return {
    id: `pv_${over.versionSeq}`,
    effectiveFrom: T0,
    effectiveTo: T0 + 365 * DAY,
    state: "effective",
    premiumMinor: 120_000,
    premiumDeltaMinor: 0,
    ...over
  };
}

/** Replays migrations in order, optionally stopping before one of them. */
async function migrate(db: Client, opts: { until?: string } = {}) {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (opts.until && file >= opts.until) break;
    for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
      if (sql.trim()) await db.execute(sql.trim());
    }
  }
}

async function applyMigration(db: Client, prefix: string) {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  if (!file) throw new Error(`no migration starting ${prefix}`);
  for (const sql of readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint")) {
    if (sql.trim()) await db.execute(sql.trim());
  }
}

describe("policy version invariants", () => {
  it("exactly one effective version per policy", () => {
    const head = { currentVersionId: "pv_2", versionSeq: 2, premiumMinor: 150_000 };
    const good = [
      version({ versionSeq: 1, state: "superseded", effectiveTo: T0 + 90 * DAY }),
      version({
        versionSeq: 2,
        effectiveFrom: T0 + 90 * DAY,
        premiumMinor: 150_000,
        premiumDeltaMinor: 30_000
      })
    ];
    expect(policyVersionViolations(head, good)).toEqual([]);

    // Two effective rows: the schedule in force is ambiguous, which is the whole
    // failure F5 describes — the UI picked whichever row sorted first.
    const twoLive = [{ ...good[0]!, state: "effective" }, good[1]!];
    expect(policyVersionViolations(head, twoLive)).toContain(
      "expected exactly one effective version, found 2"
    );

    // A version list with none effective is equally broken.
    const noneLive = [good[0]!, { ...good[1]!, state: "superseded" }];
    expect(policyVersionViolations(head, noneLive)).toContain(
      "expected exactly one effective version, found 0"
    );

    expect(policyVersionViolations(head, [])).toEqual(["policy has no versions"]);
  });

  it("version intervals are contiguous and non-overlapping", () => {
    const head = { currentVersionId: "pv_2", versionSeq: 2, premiumMinor: 120_000 };
    const v1 = version({ versionSeq: 1, state: "superseded", effectiveTo: T0 + 90 * DAY });
    const v2 = version({ versionSeq: 2, effectiveFrom: T0 + 90 * DAY });

    expect(policyVersionViolations(head, [v1, v2])).toEqual([]);

    // Gap: a day nobody can say what cover was in force on.
    const gapped = [v1, { ...v2, effectiveFrom: T0 + 91 * DAY }];
    expect(policyVersionViolations(head, gapped).join("|")).toContain("are not contiguous");

    // Overlap: two schedules claim the same day.
    const overlapped = [v1, { ...v2, effectiveFrom: T0 + 80 * DAY }];
    expect(policyVersionViolations(head, overlapped).join("|")).toContain("are not contiguous");

    // A voided row is excluded from the interval chain — it never took effect.
    const voided = version({
      versionSeq: 3,
      state: "voided",
      effectiveFrom: T0 + 200 * DAY,
      effectiveTo: T0 + 400 * DAY
    });
    expect(policyVersionViolations(head, [v1, v2, voided])).toEqual([]);

    // ...but it still consumes a seq, so density is measured over every row.
    expect(policyVersionViolations(head, [v1, v2, { ...voided, versionSeq: 4 }]).join("|")).toContain(
      "not dense from 1"
    );
  });

  it("head denormalizations track the effective version", () => {
    const v1 = version({ versionSeq: 1, state: "superseded", effectiveTo: T0 + 90 * DAY });
    const v2 = version({
      versionSeq: 2,
      effectiveFrom: T0 + 90 * DAY,
      premiumMinor: 150_000,
      premiumDeltaMinor: 30_000
    });

    expect(
      policyVersionViolations({ currentVersionId: "pv_1", versionSeq: 2, premiumMinor: 150_000 }, [v1, v2])
    ).toContain("head.currentVersionId does not point at the effective version");

    expect(
      policyVersionViolations({ currentVersionId: "pv_2", versionSeq: 1, premiumMinor: 150_000 }, [v1, v2])
        .join("|")
    ).toContain("head.versionSeq 1 != effective version 2");

    // The head premium must be reachable by walking the deltas, or the ledger
    // and the schedule disagree about what was charged.
    expect(
      policyVersionViolations({ currentVersionId: "pv_2", versionSeq: 2, premiumMinor: 999_000 }, [v1, v2])
        .join("|")
    ).toContain("premium deltas sum to 30000 but the head moved 879000");
  });
});

describe("migration 0016", () => {
  it("0016 backfill creates a v1 for every existing policy", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db, { until: "0016" });

    const now = T0;
    const rows = [
      { id: "pol_a", no: "A-1", premium: 120_000, start: T0, end: T0 + 365 * DAY, ccy: "AED" },
      { id: "pol_b", no: "B-1", premium: 90_050, start: T0 - 30 * DAY, end: T0 + 335 * DAY, ccy: "AED" },
      // Second tenant: the backfill must not leak a version across tenants.
      { id: "pol_c", no: "C-1", premium: 500_000, start: T0, end: T0 + 180 * DAY, ccy: "ZAR" }
    ];
    for (const r of rows) {
      await db.execute({
        sql: `INSERT INTO axis_policies
                (id, tenant_id, customer_id, provider_id, policy_no, start_at, end_at,
                 premium_minor, currency, commission_minor, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        args: [
          r.id,
          r.id === "pol_c" ? "ten_2" : "ten_1",
          "cus_1",
          "prv_1",
          r.no,
          r.start,
          r.end,
          r.premium,
          r.ccy,
          1_000,
          now,
          now
        ]
      });
    }

    await applyMigration(db, "0016");

    const versions = (
      await db.execute("SELECT * FROM axis_policy_versions ORDER BY policy_id")
    ).rows;
    expect(versions.length).toBe(3);

    for (const r of rows) {
      const v = versions.find((x) => String(x.policy_id) === r.id);
      expect(v, `${r.id} has no v1`).toBeDefined();
      expect(Number(v!.version_seq)).toBe(1);
      expect(String(v!.state)).toBe("effective");
      expect(String(v!.reason)).toBe("issue");
      expect(Number(v!.premium_minor)).toBe(r.premium);
      expect(Number(v!.effective_from)).toBe(r.start);
      expect(Number(v!.effective_to)).toBe(r.end);
      expect(String(v!.currency)).toBe(r.ccy);
      expect(String(v!.tenant_id)).toBe(r.id === "pol_c" ? "ten_2" : "ten_1");

      const head = (
        await db.execute({ sql: "SELECT * FROM axis_policies WHERE id = ?", args: [r.id] })
      ).rows[0]!;
      expect(String(head.current_version_id)).toBe(String(v!.id));
      expect(Number(head.version_seq)).toBe(1);
      expect(Number(head.renewal_seq)).toBe(0);
      expect(Number(head.gross_minor)).toBe(r.premium);
    }

    // The backfilled history satisfies the invariants it was written to protect.
    for (const r of rows) {
      const head = (
        await db.execute({ sql: "SELECT * FROM axis_policies WHERE id = ?", args: [r.id] })
      ).rows[0]!;
      const vs = (
        await db.execute({
          sql: "SELECT * FROM axis_policy_versions WHERE policy_id = ?",
          args: [r.id]
        })
      ).rows.map((x) => ({
        id: String(x.id),
        versionSeq: Number(x.version_seq),
        effectiveFrom: Number(x.effective_from),
        effectiveTo: Number(x.effective_to),
        state: String(x.state),
        premiumMinor: Number(x.premium_minor),
        premiumDeltaMinor: Number(x.premium_delta_minor)
      }));
      expect(
        policyVersionViolations(
          {
            currentVersionId: String(head.current_version_id),
            versionSeq: Number(head.version_seq),
            premiumMinor: Number(head.premium_minor)
          },
          vs
        )
      ).toEqual([]);
    }
  });

  it("keeps one version per policy id and seq", async () => {
    const db = createClient({ url: ":memory:" });
    await migrate(db);
    const idx = (
      await db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'axis_policy_versions'"
      )
    ).rows.map((r) => String(r.name));
    expect(idx).toContain("axis_policy_versions_seq_uq");
    expect(idx).toContain("axis_policy_versions_policy_idx");
  });
});
