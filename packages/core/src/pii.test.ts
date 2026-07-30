import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@lyra/db";
import { mask, CUSTOMER_PII, type PiiMap } from "./pii.js";
import { permissionsForRole, type Actor } from "./rbac.js";

// These tests exist because CUSTOMER_PII once declared `email` / `phone` /
// `name.en` while the columns were `emailsJson` / `phonesJson` / `nameJson`.
// Every path missed, mask() returned the row untouched, and no test noticed
// because the only fixture was a hand-written object that matched the map
// instead of the database. So: fixtures are shaped like real rows, assertions
// are made on the serialised output, and a path-integrity loop pins every
// declared path to a real Drizzle column.

function actor(roleKey: string): Actor {
  return {
    kind: "user",
    id: "u_1",
    tenantId: "t_1",
    grants: [{ roleKey, permissions: permissionsForRole(roleKey) }]
  };
}

const agent = actor("axis.agent"); // no core:pii:view
const lead = actor("axis.lead"); // holds core:pii:view

/** A customer exactly as it leaves `hydrate()` in apps/api/src/crud.ts. */
function customerRow() {
  return {
    id: "cu_01HQ",
    tenantId: "t_1",
    type: "person",
    nameJson: { en: "Rania Haddad", ar: "رانيا حداد" },
    emailsJson: ["rania.haddad@example.ae", "r.haddad@work.example.ae"],
    phonesJson: ["+971501234567"],
    nationalIdHash: "9f2c41ab77de0031aa",
    kycStatus: "verified",
    consentId: "cs_1",
    tagsJson: ["vip"],
    ltvCached: 42_000,
    riskFlagsJson: null,
    locale: "en",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null
  };
}

/** Every PII value that must never survive serialisation for an unprivileged actor. */
const SECRETS = [
  "rania.haddad@example.ae",
  "r.haddad@work.example.ae",
  "rania.haddad",
  "r.haddad",
  "+971501234567",
  "971501234567",
  "50123456",
  "Haddad",
  "حداد",
  "9f2c41ab77de0031aa"
];

describe("CUSTOMER_PII masking", () => {
  it("masks a real customer row for an actor without core:pii:view", () => {
    const masked = mask(agent, customerRow(), CUSTOMER_PII, "t_1");
    // Serialise: a nested miss (a path that stopped matching one level down)
    // cannot hide behind a passing top-level assertion.
    const json = JSON.stringify(masked);
    for (const secret of SECRETS) expect(json).not.toContain(secret);

    // The masked shape is still usable: same keys, same arity, readable values.
    expect(Object.keys(masked)).toEqual(Object.keys(customerRow()));
    expect(masked.emailsJson).toHaveLength(2);
    expect(masked.emailsJson[0]).toBe("r•••••••••••@example.ae");
    expect(masked.phonesJson[0]).toBe("+••••••••4567");
    expect(masked.nameJson.en).toBe("Rania H•••••");
    expect(masked.nameJson.ar).not.toBe("رانيا حداد");
    expect(masked.kycStatus).toBe("verified"); // non-PII untouched
    expect(masked.ltvCached).toBe(42_000);
  });

  it("leaves the row intact for an actor with core:pii:view", () => {
    expect(mask(lead, customerRow(), CUSTOMER_PII, "t_1")).toEqual(customerRow());
  });

  it("masks every row of a list, not just the first", () => {
    const json = JSON.stringify(mask(agent, [customerRow(), customerRow()], CUSTOMER_PII, "t_1"));
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it("survives null, absent and malformed PII fields without dropping data", () => {
    const row = {
      id: "cu_02",
      nameJson: "{not json", // hydrate() hands back the raw text on a parse failure
      emailsJson: null,
      // phonesJson absent entirely
      nationalIdHash: null,
      kycStatus: "none"
    };
    const masked = mask(agent, row, CUSTOMER_PII, "t_1");
    expect(Object.keys(masked)).toEqual(Object.keys(row));
    expect(masked.emailsJson).toBeNull();
    expect(masked.nationalIdHash).toBeNull();
    expect(masked.kycStatus).toBe("none");
    // A blob that will not parse is redacted, never returned raw. hydrate() in
    // apps/api/src/crud.ts deliberately hands back malformed JSON as text, so
    // this is a live path, not a hypothetical one.
    expect(masked.nameJson).toBe("[redacted]");
    expect(JSON.stringify(masked)).not.toContain("not json");
  });

  it("masks a raw Drizzle row whose JSON columns are still strings", () => {
    // Any hand-written route that skips hydrate() ends up here. Masking must not
    // depend on a caller remembering to parse first.
    const hydrated = customerRow();
    const raw = {
      ...hydrated,
      nameJson: JSON.stringify(hydrated.nameJson),
      emailsJson: JSON.stringify(hydrated.emailsJson),
      phonesJson: JSON.stringify(hydrated.phonesJson)
    };
    const masked = mask(agent, raw, CUSTOMER_PII, "t_1");
    const json = JSON.stringify(masked);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    // Still a string, so the column keeps its shape for whatever reads it next.
    expect(typeof masked.emailsJson).toBe("string");
    expect(JSON.parse(masked.phonesJson)).toEqual(["+••••••••4567"]);
  });
});

describe("PII path integrity", () => {
  /**
   * Returns the declared paths that match nothing on `table`. A path's first
   * segment must be a real column; a dotted path is only meaningful on a JSON
   * column, since those are the only ones hydrated into nested objects.
   */
  function unmatchedPaths(map: PiiMap, table: Table): string[] {
    const columns = new Set(Object.keys(getTableColumns(table)));
    return Object.keys(map).filter((path) => {
      const [root = "", ...rest] = path.split(".");
      if (!columns.has(root)) return true;
      return rest.length > 0 && !root.endsWith("Json");
    });
  }

  it("declares no CUSTOMER_PII path that no core_customers column can satisfy", () => {
    expect(unmatchedPaths(CUSTOMER_PII, schema.customers)).toEqual([]);
  });

  it("catches a path that does not exist (the bug this file was written for)", () => {
    // The map as it shipped broken — proof the loop above actually fails.
    const broken: PiiMap = { "name.en": "name", email: "email", phones: "phone" };
    expect(unmatchedPaths(broken, schema.customers)).toEqual(["name.en", "email", "phones"]);
  });
});
