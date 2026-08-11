import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import {
  LABELS as PERIOD_LABELS,
  PERM,
  SETTLEMENT_STATES,
  filtersFrom,
  percentFromPpm,
  queueGroups,
  reasonError,
  refFor,
  settlementTone,
  transitionsFor,
  action as run,
  loader as periodLoader,
  type Settlement
} from "./settlement";
import {
  LABELS as DETAIL_LABELS,
  approvalOf,
  channelOf,
  labelsIn as detailLabelsIn,
  lineSums,
  netHolds,
  pdfSafe,
  sharePpm,
  action as transition,
  loader as detailLoader,
  type LinesPayload
} from "./settlement-detail";

// The settlement screens. Everything below is either money (minor units stay
// integers, a rate is never shown as its raw ppm), a signature (two decisions,
// two permissions, and a control the actor cannot use is absent), or a refusal
// rendered as a notice rather than a crash.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

const settlement: Settlement = {
  id: "stl_01",
  counterpartyKind: "partner",
  counterpartyRef: "channel:brokerAlpha",
  period: "2026-06",
  grossMinor: 120_000,
  adjustmentsMinor: 5_000,
  netMinor: 125_000,
  currency: "AED",
  statementFileId: null,
  state: "draft",
  approvedBy: null,
  txnId: null,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000
};

const lines: LinesPayload = {
  settlement,
  table: {
    title: "Remittance advice 2026-06 — channel:brokerAlpha",
    columns: [
      { key: "earnedOn", label: "Earned", kind: "text" },
      { key: "policyId", label: "Policy", kind: "text" },
      { key: "bucket", label: "Bucket", kind: "text" },
      { key: "premiumMinor", label: "Premium", kind: "money" },
      { key: "grossCommissionMinor", label: "Gross commission", kind: "money" },
      { key: "channelCommissionMinor", label: "Channel share", kind: "money" },
      { key: "agreement", label: "Agreement", kind: "text" }
    ],
    rows: [
      {
        earnedOn: "2026-06-04",
        policyId: "pol_01",
        bucket: "2026-06",
        premiumMinor: 1_000_000,
        grossCommissionMinor: 150_000,
        channelCommissionMinor: 60_000,
        agreement: "v2"
      },
      {
        earnedOn: "2026-05-28",
        policyId: "pol_02",
        bucket: "carried in",
        premiumMinor: 500_000,
        grossCommissionMinor: 100_000,
        channelCommissionMinor: 40_000,
        agreement: "v2"
      }
    ],
    currency: "AED",
    generatedAt: 1_700_000_000
  },
  totals: { grossMinor: 60_000, adjustmentsMinor: 40_000, netMinor: 100_000 },
  terms: { minPayoutMinor: 50_000, agreementId: "pag_01", agreementVersion: 2 }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each call by the first URL fragment that matches; records the lot. */
function stubApi(replies: Array<[string, Response]>) {
  const calls: Array<{ url: string; method: string; body: string | null; headers: Headers }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      headers: new Headers(init.headers)
    });
    const hit = replies.find(([fragment]) => url.includes(fragment));
    if (!hit) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(hit[1].clone());
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function me(...permissions: string[]): Response {
  return json({ id: "usr_01", permissions, roles: [], tenantId: "t1", locale: "en" });
}

/** Loader/action args with just the pieces these handlers read. */

function args(url: string, init?: RequestInit, params: Record<string, string> = {}): any {
  return { request: new Request(url, init), params, context: { get: () => ({ env, ctx: {} }) } };
}

function form(entries: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(entries)) body.set(key, value);
  return body;
}

const held = (...permissions: string[]) => new Set(permissions);

/* ----------------------------------------------------------------- contract */

describe("the permissions these screens gate on", () => {
  it("spells them as apps/api/src/openapi.ts does", () => {
    expect(PERM.read).toBe("dist:commissions:read");
    expect(PERM.settle).toBe("dist:commissions:settle");
    // The payout is a different grant from the approval: one person signs the
    // number, another releases the money (CLAUDE.md §12).
    expect(PERM.pay).toBe("ledger:payouts:approve");
    expect(PERM.settle).not.toBe(PERM.pay);
  });
});

/* -------------------------------------------------------------------- money */

describe("money and rates", () => {
  it("adds the displayed lines up without leaving minor units", () => {
    const sums = lineSums(lines.table);

    expect(sums.premiumMinor).toBe(1_500_000);
    expect(sums.grossCommissionMinor).toBe(250_000);
    expect(sums.channelCommissionMinor).toBe(100_000);
    // The period's own earnings and what was carried in are separate figures:
    // the second is why a net can be larger than a month's gross.
    expect(sums.periodMinor).toBe(60_000);
    expect(sums.carriedInMinor).toBe(40_000);
  });

  it("reconciles the lines against the settlement's own totals", () => {
    const sums = lineSums(lines.table, "2026-06");
    expect(sums.periodMinor).toBe(lines.totals.grossMinor);
    expect(sums.carriedInMinor).toBe(lines.totals.adjustmentsMinor);
  });

  it("holds the ledger invariant gross + adjustments = net", () => {
    expect(netHolds(lines.totals)).toBe(true);
    // A settlement whose net does not follow from its parts is a defect to be
    // shown, not rounded away.
    expect(netHolds({ grossMinor: 60_000, adjustmentsMinor: 40_000, netMinor: 99_999 })).toBe(false);
  });

  it("renders a ppm rate as a percentage, never as its raw integer", () => {
    expect(percentFromPpm(125_000)).toBe("12.5%");
    expect(percentFromPpm(400_000)).toBe("40%");
    expect(percentFromPpm(1_000_000)).toBe("100%");
    expect(percentFromPpm(0)).toBe("0%");
  });

  it("derives a line's share of gross in ppm, and refuses to divide by nothing", () => {
    expect(sharePpm(150_000, 60_000)).toBe(400_000);
    expect(sharePpm(0, 60_000)).toBeNull();
  });
});

/* ------------------------------------------------------------------- states */

describe("state badges", () => {
  it("gives each settlement state its own tone", () => {
    const tones = ["draft", "approved", "paid", "disputed"].map(settlementTone);
    expect(new Set(tones).size).toBe(4);
    expect(settlementTone("paid")).toBe("success");
    expect(settlementTone("disputed")).toBe("danger");
  });

  it("tones the entry states a statement shows rather than greying them", () => {
    // The generic `toneFor` has no entry states, so these would all fall
    // through to neutral: a disputed line must not look like a draft.
    expect(settlementTone("payable")).not.toBe("neutral");
    expect(settlementTone("accrued")).not.toBe("neutral");
    expect(settlementTone("clawed_back")).toBe("danger");
  });
});

/* -------------------------------------------------------------- transitions */

describe("which transitions are offered", () => {
  const intents = (s: Partial<Settlement>, permissions: string[]) =>
    transitionsFor({ ...settlement, ...s }, held(...permissions)).map((tr) => tr.intent);

  it("offers approve and dispute on a draft to whoever may settle", () => {
    expect(intents({ state: "draft" }, [PERM.settle])).toEqual(["approve", "dispute"]);
  });

  it("withholds approve when the period has nothing to pay, as the API refuses it", () => {
    // Below the payout floor the balance carries forward; approving it would
    // post a zero accrual.
    expect(intents({ state: "draft", netMinor: 0 }, [PERM.settle])).toEqual(["dispute"]);
  });

  it("does not let the approver release the money", () => {
    expect(intents({ state: "approved" }, [PERM.settle])).toEqual(["dispute"]);
  });

  it("does not let the payer approve the number", () => {
    expect(intents({ state: "draft" }, [PERM.pay])).toEqual([]);
    expect(intents({ state: "approved" }, [PERM.pay])).toEqual(["pay"]);
  });

  it("offers nothing at all on a paid settlement", () => {
    expect(intents({ state: "paid", txnId: "txn_01" }, [PERM.settle, PERM.pay])).toEqual([]);
  });

  it("reopens a dispute only while nothing has posted", () => {
    expect(intents({ state: "disputed" }, [PERM.settle])).toEqual(["reopen"]);
    expect(intents({ state: "disputed", txnId: "txn_01" }, [PERM.settle])).toEqual([]);
  });

  it("asks for a reason and an explicit confirmation on the consequential ones", () => {
    const byIntent = Object.fromEntries(
      transitionsFor({ ...settlement, state: "approved" }, held(PERM.settle, PERM.pay)).map((tr) => [
        tr.intent,
        tr
      ])
    );
    expect(byIntent.pay).toMatchObject({ reason: false, confirm: true });
    expect(byIntent.dispute).toMatchObject({ reason: true, confirm: true });
  });
});

/* ------------------------------------------------------------------ reasons */

describe("the reason the API requires", () => {
  it("refuses an empty or too-short one before the round trip", () => {
    expect(reasonError(null)).toBe("reasonRequired");
    expect(reasonError("  ")).toBe("reasonRequired");
    expect(reasonError("no")).toBe("reasonRequired");
  });

  it("refuses one longer than the API's 500 characters", () => {
    expect(reasonError("x".repeat(501))).toBe("reasonTooLong");
    expect(reasonError("x".repeat(500))).toBeNull();
  });

  it("accepts a real explanation", () => {
    expect(reasonError("Broker disputes the renewal on pol_02.")).toBeNull();
  });
});

/* ---------------------------------------------------------------- guardrail */

describe("an approval gate", () => {
  it("is read off the problem body, with the policy it fired on", () => {
    expect(
      approvalOf({
        title: "approval required",
        status: 403,
        code: "approval_required",
        policy_key: "ledger.partner_settlement",
        approval_id: "apr_01"
      } as never)
    ).toEqual({ policyKey: "ledger.partner_settlement", approvalId: "apr_01" });
  });

  it("is not confused with a plain refusal", () => {
    expect(approvalOf({ title: "forbidden", status: 403 })).toBeNull();
    expect(approvalOf({ title: "conflict", status: 409 })).toBeNull();
    expect(approvalOf(null)).toBeNull();
  });
});

/* ----------------------------------------------------------------- statement */

describe("statement formats", () => {
  it("keeps PDF on an advice the PDF fonts can carry, em dash and all", () => {
    expect(pdfSafe(lines.table)).toBe(true);
  });

  it("withholds PDF when a line carries a script the fonts cannot render", () => {
    const arabic = {
      ...lines.table,
      rows: [{ ...lines.table.rows[0], policyId: "وثيقة" }]
    };
    // The API answers 400 here; offering the button would be a promise the
    // download cannot keep.
    expect(pdfSafe(arabic)).toBe(false);
  });
});

/* --------------------------------------------------------------- references */

describe("counterparty references", () => {
  it("builds the channel reference the engine demands", () => {
    expect(refFor(" brokerAlpha ")).toBe("channel:brokerAlpha");
    expect(refFor("")).toBeNull();
  });

  it("reads the channel back out for display", () => {
    expect(channelOf("channel:brokerAlpha")).toBe("brokerAlpha");
    expect(channelOf("partner:other")).toBe("partner:other");
  });
});

/* -------------------------------------------------------------------- queue */

describe("the settlement queue", () => {
  it("groups by state and currency, never adding two currencies together", () => {
    const groups = queueGroups([
      settlement,
      { ...settlement, id: "stl_02", state: "paid", netMinor: 75_000 },
      { ...settlement, id: "stl_03", state: "paid", netMinor: 25_000 },
      { ...settlement, id: "stl_04", state: "paid", currency: "ZAR", netMinor: 9_000 }
    ]);

    expect(groups).toEqual([
      { state: "draft", currency: "AED", count: 1, netMinor: 125_000 },
      { state: "paid", currency: "AED", count: 2, netMinor: 100_000 },
      { state: "paid", currency: "ZAR", count: 1, netMinor: 9_000 }
    ]);
  });
});

/* -------------------------------------------------------------- the loaders */

describe("the period screen", () => {
  it("asks the API for nothing without the read permission, and says so", async () => {
    const calls = stubApi([["/v1/me", me("ledger:txns:read")]]);
    const loaded = await periodLoader(args("https://web.test/ledger/settlement"));

    expect(loaded.may.read).toBe(false);
    expect(loaded.settlements).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual(["https://api.test/v1/me"]);
  });

  it("filters the queue by the counterparty and period in the URL", async () => {
    const calls = stubApi([
      ["/v1/me", me(PERM.read)],
      ["/v1/ledger/settlements", json({ data: [settlement] })]
    ]);
    const loaded = await periodLoader(
      args("https://web.test/ledger/settlement?counterpartyKind=partner&channelId=brokerAlpha&period=2026-06")
    );

    // The channel picker's list is fetched alongside; the queue call is the
    // one that carries the filters.
    const queue = calls.map((call) => call.url).find((url) => url.includes("/settlements"))!;
    expect(queue).toContain("counterpartyKind=partner");
    expect(queue).toContain(`counterpartyRef=${encodeURIComponent("channel:brokerAlpha")}`);
    expect(queue).toContain("period=2026-06");
    expect(loaded.settlements).toHaveLength(1);
    expect(loaded.may.settle).toBe(false);
  });

  it("turns a refusal into a denial rather than an exception", async () => {
    stubApi([
      ["/v1/me", me(PERM.read)],
      ["/v1/ledger/settlements", json({ title: "forbidden", status: 403 }, 403)]
    ]);
    const loaded = await periodLoader(args("https://web.test/ledger/settlement"));

    expect(loaded.may.read).toBe(false);
    expect(loaded.settlements).toEqual([]);
  });

  it("keeps only the context it understands out of the query string", () => {
    const url = new URL("https://web.test/s?counterpartyKind=insurer&channelId=%20&period=2026-6&x=1");
    // `insurer` is money in, not out — the engine refuses it, so it is not a
    // choice this screen makes; a malformed month is dropped rather than sent.
    expect(filtersFrom(url)).toEqual({});
  });
});

describe("drafting a period", () => {
  it("posts the run with an idempotency key so a double submit drafts once", async () => {
    const calls = stubApi([["/v1/settlement/runs", json({ settlement, totals: {}, terms: {}, entryCount: 2 }, 201)]]);
    const result = await run(
      args("https://web.test/ledger/settlement", {
        method: "POST",
        body: form({
          intent: "run",
          idempotencyKey: "key_01",
          counterpartyKind: "partner",
          channelId: "brokerAlpha",
          period: "2026-06",
          currency: "aed"
        })
      })
    );

    expect(calls[0]?.headers.get("idempotency-key")).toBe("key_01");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      counterpartyKind: "partner",
      counterpartyRef: "channel:brokerAlpha",
      period: "2026-06",
      currency: "AED"
    });
    expect(result).toMatchObject({ error: null, problem: null });
  });

  it("refuses a malformed period without calling the API", async () => {
    const calls = stubApi([["/v1/settlement/runs", json(settlement, 201)]]);
    const result = await run(
      args("https://web.test/ledger/settlement", {
        method: "POST",
        body: form({ intent: "run", counterpartyKind: "partner", channelId: "brokerAlpha", period: "2026" })
      })
    );

    expect(result).toMatchObject({ error: "periodInvalid", run: null });
    expect(calls).toHaveLength(0);
  });

  it("refuses a run with no counterparty without calling the API", async () => {
    const calls = stubApi([["/v1/settlement/runs", json(settlement, 201)]]);
    const result = await run(
      args("https://web.test/ledger/settlement", {
        method: "POST",
        body: form({ intent: "run", counterpartyKind: "partner", channelId: " ", period: "2026-06" })
      })
    );

    expect(result).toMatchObject({ error: "channelRequired", run: null });
    expect(calls).toHaveLength(0);
  });
});

describe("the settlement screen", () => {
  it("reads the lines behind the total and the terms applied to them", async () => {
    stubApi([
      ["/v1/me", me(PERM.read, PERM.settle)],
      ["/lines", json(lines)]
    ]);
    const loaded = await detailLoader(args("https://web.test/ledger/settlements/stl_01", undefined, { id: "stl_01" }));

    expect(loaded.lines?.terms.minPayoutMinor).toBe(50_000);
    expect(loaded.may.pay).toBe(false);
    // The download goes straight to the API origin, so the bytes never pass
    // through a loader.
    expect(loaded.apiOrigin).toBe("https://api.test");
  });

  it("says no rather than crashing when the actor may not read it", async () => {
    const calls = stubApi([["/v1/me", me("ledger:txns:read")]]);
    const loaded = await detailLoader(args("https://web.test/ledger/settlements/stl_01", undefined, { id: "stl_01" }));

    expect(loaded.lines).toBeNull();
    expect(loaded.may.read).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("running a transition", () => {
  it("will not release money without the in-page confirmation", async () => {
    const calls = stubApi([["/pay", json(settlement)]]);
    const result = await transition(
      args("https://web.test/ledger/settlements/stl_01", { method: "POST", body: form({ intent: "pay" }) }, {
        id: "stl_01"
      })
    );

    expect(result).toMatchObject({ error: "confirmRequired", settlement: null });
    expect(calls).toHaveLength(0);
  });

  it("will not dispute without a reason the API would accept", async () => {
    const calls = stubApi([["/dispute", json(settlement)]]);
    const result = await transition(
      args(
        "https://web.test/ledger/settlements/stl_01",
        { method: "POST", body: form({ intent: "dispute", confirm: "on", reason: "no" }) },
        { id: "stl_01" }
      )
    );

    expect(result).toMatchObject({ error: "reasonRequired", settlement: null });
    expect(calls).toHaveLength(0);
  });

  it("pays with the idempotency key it was rendered with", async () => {
    const calls = stubApi([["/pay", json({ ...settlement, state: "paid" })]]);
    const result = await transition(
      args(
        "https://web.test/ledger/settlements/stl_01",
        { method: "POST", body: form({ intent: "pay", confirm: "on", idempotencyKey: "key_02" }) },
        { id: "stl_01" }
      )
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/settlement/settlements/stl_01/pay");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("key_02");
    expect(result.settlement?.state).toBe("paid");
  });

  it("sends the reason as the only body a dispute carries", async () => {
    const calls = stubApi([["/dispute", json({ ...settlement, state: "disputed" })]]);
    await transition(
      args(
        "https://web.test/ledger/settlements/stl_01",
        { method: "POST", body: form({ intent: "dispute", confirm: "on", reason: "Broker disputes pol_02." }) },
        { id: "stl_01" }
      )
    );

    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ reason: "Broker disputes pol_02." });
  });

  it("hands a gate back to the screen instead of throwing", async () => {
    stubApi([
      ["/pay", json({ title: "approval required", status: 403, code: "approval_required", policy_key: "ledger.partner_settlement" }, 403)]
    ]);
    const result = await transition(
      args(
        "https://web.test/ledger/settlements/stl_01",
        { method: "POST", body: form({ intent: "pay", confirm: "on" }) },
        { id: "stl_01" }
      )
    );

    expect(approvalOf(result.problem)).toEqual({ policyKey: "ledger.partner_settlement" });
  });

  it("refuses an intent the API has no verb for", async () => {
    const calls = stubApi([["/v1/settlement", json(settlement)]]);
    const result = await transition(
      args("https://web.test/ledger/settlements/stl_01", { method: "POST", body: form({ intent: "delete" }) }, {
        id: "stl_01"
      })
    );

    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------- i18n */

describe("the label tables", () => {
  it("translates every English key on the period screen into Arabic", () => {
    const missing = Object.keys(PERIOD_LABELS.en!).filter((key) => !(key in PERIOD_LABELS.ar!));
    expect(missing).toEqual([]);
  });

  it("translates every English key on the settlement screen into Arabic", () => {
    const missing = Object.keys(DETAIL_LABELS.en!).filter((key) => !(key in DETAIL_LABELS.ar!));
    expect(missing).toEqual([]);
  });

  it("says the shared words on a settlement rather than their keys", () => {
    const l = detailLabelsIn("en");
    // The <Gate> notice and the state badge both read through the route's own
    // resolver; hand-rolling that lookup rendered "approvalTitle" and
    // "state.draft" on screen, which is what J-X2 caught.
    expect(l("approvalTitle")).toBe("Waiting on an approval");
    expect(l("approvalBody", { policy: "dist.settlement_run" })).toContain("dist.settlement_run");
    expect(l("approvalLink")).toBe("Open the approval queue");
    for (const state of SETTLEMENT_STATES) expect(l(`state.${state}`)).not.toBe(`state.${state}`);
  });

  it("leaves no English text sitting in the Arabic catalogues", () => {
    const english = /^[\x20-\x7F]+$/;
    const suspect = [
      ...Object.entries(DETAIL_LABELS.ar!),
      ...Object.entries(PERIOD_LABELS.ar!)
      // A pure-ASCII Arabic value is either untranslated or a code (a currency,
      // a format name); the tables below hold neither.
    ].filter(([, value]) => english.test(value) && !["PDF", "XLSX", "CSV", "JSON"].includes(value));
    expect(suspect).toEqual([]);
  });
});
