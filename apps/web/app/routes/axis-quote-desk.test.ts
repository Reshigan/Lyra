import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  EXPIRY_SOON_MS,
  OPEN_CASE_STATUSES,
  action,
  byPressure,
  deskCustomers,
  deskGroups,
  epochOf,
  expiryOf,
  flagsOf,
  labelsIn,
  phrase,
  policyFrom,
  toDeskQuotes,
  type DeskCase,
  type DeskQuote,
  type QuoteResponse
} from "./axis-quote-desk";

// The desk makes three claims that can be wrong in money-shaped ways: which
// quote is cheapest, what the spread to the next one is, and what a picked quote
// turns into when it is issued. Those, plus the refusals guarding the issue, are
// what this file pins.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null; key: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: new Headers(init.headers).get("idempotency-key")
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/quote-desk", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const NOW = 1_770_000_000_000;
const DAY = 24 * 3_600_000;

const kase = (over: Partial<DeskCase> = {}): DeskCase => ({
  id: "case_1",
  ref: "C-0001",
  kind: "quote",
  status: "quoting",
  customerId: "cus_1",
  currency: "AED",
  slaDueAt: NOW + 3 * DAY,
  quoteRequestId: "qr_1",
  ...over
});

const quote = (over: Partial<DeskQuote> = {}): DeskQuote => ({
  id: "q_1",
  requestId: "qr_1",
  caseId: "case_1",
  providerId: "prov_a",
  premiumMinor: 500_000,
  currency: "AED",
  validUntil: NOW + 30 * DAY,
  winFlag: false,
  declineReason: null,
  source: "manual",
  createdAt: NOW - DAY,
  ...over
});

describe("labelsIn", () => {
  it("translates every key into Arabic, group wording included", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "title.group",
      "intro",
      "intro.group",
      "stat.cases",
      "stat.quotes",
      "stat.expiring",
      "stat.silent",
      "group.silent",
      "group.best",
      "group.spread",
      "flag.best",
      "flag.won",
      "flag.expired",
      "flag.soon",
      "flag.declined",
      "pick.submit",
      "pick.hint",
      "decline.submit",
      "decline.reason",
      "issue.title",
      "issue.intro",
      "issue.quote",
      "issue.policyNo",
      "issue.customer",
      "issue.start",
      "issue.end",
      "issue.submit",
      "issue.none",
      "done.pick",
      "done.decline",
      "done.issue",
      "empty.title",
      "empty.body",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "problem.bad_intent",
      "problem.missing_quote",
      "problem.missing_reason",
      "problem.missing_policy",
      "problem.bad_dates"
    ];

    for (const key of keys) {
      expect(en(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(key);
      expect(ar(key), key).not.toBe(en(key));
    }
  });

  it("interpolates the gating policy in both locales", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
    expect(labelsIn("ar")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
  });

  it("falls back to English rather than showing a raw key", () => {
    expect(labelsIn("de")("title")).toBe(labelsIn("en")("title"));
  });
});

describe("expiryOf", () => {
  it("treats an open-ended quote as live, not as expired at the epoch", () => {
    expect(expiryOf({ validUntil: null }, NOW)).toBe("live");
  });

  it("splits expired, expiring-soon and comfortably live", () => {
    expect(expiryOf({ validUntil: NOW - 1 }, NOW)).toBe("expired");
    expect(expiryOf({ validUntil: NOW + EXPIRY_SOON_MS - 1 }, NOW)).toBe("soon");
    expect(expiryOf({ validUntil: NOW + EXPIRY_SOON_MS + 1 }, NOW)).toBe("live");
  });
});

describe("deskGroups", () => {
  it("groups quotes under their case, cheapest first", () => {
    const groups = deskGroups(
      [kase()],
      [quote({ id: "dear", premiumMinor: 900_000 }), quote({ id: "cheap", premiumMinor: 400_000 })],
      NOW
    );
    expect(groups[0]?.bids.map((b) => b.id)).toEqual(["cheap", "dear"]);
    expect(groups[0]?.bestMinor).toBe(400_000);
    expect(groups[0]?.spreadMinor).toBe(500_000);
  });

  it("never calls an expired or declined quote the best price", () => {
    const groups = deskGroups(
      [kase()],
      [
        quote({ id: "stale", premiumMinor: 100_000, validUntil: NOW - DAY }),
        quote({ id: "refused", premiumMinor: 200_000, declineReason: "out of appetite" }),
        quote({ id: "usable", premiumMinor: 700_000 })
      ],
      NOW
    );
    expect(groups[0]?.bestMinor).toBe(700_000);
    expect(groups[0]?.bids.find((b) => b.best)?.id).toBe("usable");
    // Only one live quote is left, so there is no spread to negotiate against.
    expect(groups[0]?.spreadMinor).toBeNull();
  });

  it("keeps a case nobody has priced, with no best and no spread", () => {
    const groups = deskGroups([kase({ id: "silent" })], [], NOW);
    expect(groups[0]?.bids).toHaveLength(0);
    expect(groups[0]?.bestMinor).toBeNull();
    expect(groups[0]?.spreadMinor).toBeNull();
  });

  it("does not leak a quote onto another case", () => {
    const groups = deskGroups(
      [kase({ id: "a", ref: "C-A" }), kase({ id: "b", ref: "C-B" })],
      [quote({ caseId: "b" })],
      NOW
    );
    expect(groups.find((g) => g.case.id === "a")?.bids).toHaveLength(0);
    expect(groups.find((g) => g.case.id === "b")?.bids).toHaveLength(1);
  });

  it("counts the quotes about to expire on each case", () => {
    const groups = deskGroups(
      [kase()],
      [quote({ id: "soon", validUntil: NOW + DAY }), quote({ id: "later" })],
      NOW
    );
    expect(groups[0]?.expiringSoon).toBe(1);
  });
});

describe("byPressure", () => {
  it("puts unanswered cases first, then the ones with something expiring", () => {
    const groups = deskGroups(
      [
        kase({ id: "quiet", ref: "C-Q" }),
        kase({ id: "silent", ref: "C-S" }),
        kase({ id: "urgent", ref: "C-U" })
      ],
      [
        quote({ id: "q1", caseId: "quiet" }),
        quote({ id: "q2", caseId: "urgent", validUntil: NOW + DAY })
      ],
      NOW
    );
    expect([...groups].sort(byPressure).map((g) => g.case.id)).toEqual(["silent", "urgent", "quiet"]);
  });
});

describe("flagsOf", () => {
  it("marks the picked and cheapest quote, and never both expiry states", () => {
    const [best] = deskGroups([kase()], [quote({ winFlag: true })], NOW)[0]!.bids;
    const keys = flagsOf(best!).map((f) => f.key);
    expect(keys).toContain("flag.won");
    expect(keys).toContain("flag.best");
    expect(keys).not.toContain("flag.expired");

    const [stale] = deskGroups([kase()], [quote({ validUntil: NOW - 1 })], NOW)[0]!.bids;
    const staleKeys = flagsOf(stale!).map((f) => f.key);
    expect(staleKeys).toContain("flag.expired");
    expect(staleKeys).not.toContain("flag.soon");
    expect(staleKeys).not.toContain("flag.best");
  });
});

describe("epochOf", () => {
  it("reads a date input as UTC midnight and rejects anything else", () => {
    expect(epochOf("2026-08-04")).toBe(Date.parse("2026-08-04T00:00:00Z"));
    expect(epochOf("04/08/2026")).toBeNull();
    expect(epochOf("")).toBeNull();
  });
});

describe("toDeskQuotes", () => {
  const response = (over: Partial<QuoteResponse> = {}): QuoteResponse => ({
    id: "qs_1",
    requestId: "qr_1",
    providerId: "prov_a",
    premiumMinor: 500_000,
    currency: "AED",
    validUntil: NOW + 30 * DAY,
    declineReason: null,
    selectedAt: null,
    latencyMs: 420,
    createdAt: NOW - DAY,
    ...over
  });

  it("hangs each response on the case whose shop it answered", () => {
    const bids = toDeskQuotes([kase({ quoteRequestId: "qr_9" })], [response({ requestId: "qr_9" })]);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.caseId).toBe("case_1");
    expect(bids[0]?.requestId).toBe("qr_9");
  });

  it("drops an answer whose shop belongs to no case on this desk", () => {
    expect(toDeskQuotes([kase({ quoteRequestId: "qr_1" })], [response({ requestId: "qr_other" })])).toEqual([]);
  });

  // A panel decline or a timeout never carried a price. Showing it as a bid
  // would put a zero, or a blank, into the cheapest-price comparison.
  it("drops an unpriced answer rather than comparing it", () => {
    expect(toDeskQuotes([kase()], [response({ premiumMinor: null, declineReason: "no appetite" })])).toEqual([]);
  });

  it("reads selection as the win and a missing latency as a hand-keyed quote", () => {
    const [machine] = toDeskQuotes([kase()], [response({ selectedAt: NOW })]);
    expect(machine?.winFlag).toBe(true);
    expect(machine?.source).toBe("api");

    const [keyed] = toDeskQuotes([kase()], [response({ latencyMs: null })]);
    expect(keyed?.winFlag).toBe(false);
    expect(keyed?.source).toBe("manual");
  });
});

describe("pick / decline", () => {
  // F13: one quote table means one selection verb — the same `/select` the
  // customer-facing comparison posts to, not an AXIS-only winner flag.
  it("selects the winning response on its shop, with an idempotency key", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "pick");
    form.set("quoteId", "qs_7");
    form.set("requestId", "qr_7");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/dist/quote-requests/qr_7/select");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ responseId: "qs_7" }));
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ problem: null, done: "pick" });
  });

  it("refuses a pick that names no shop, so it cannot select against the wrong one", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "pick");
    form.set("quoteId", "qs_7");

    expect((await action(args(form))).problem?.code).toBe("missing_quote");
    expect(calls).toHaveLength(0);
  });

  it("carries the decline reason the provider is told", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "decline");
    form.set("quoteId", "qs_7");
    form.set("reason", "loading too high");

    expect((await action(args(form))).done).toBe("decline");
    expect(calls[0]?.url).toBe("https://api.test/v1/axis/quote-responses/qs_7/decline");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ reason: "loading too high" }));
  });

  it("refuses a reasonless decline without calling the API", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "decline");
    form.set("quoteId", "qs_7");
    form.set("reason", "   ");

    expect((await action(args(form))).problem?.code).toBe("missing_reason");
    expect(calls).toHaveLength(0);
  });

  it("refuses a submission naming no quote", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "pick");

    expect((await action(args(form))).problem?.code).toBe("missing_quote");
    expect(calls).toHaveLength(0);
  });
});

describe("policyFrom", () => {
  const full = () => {
    const form = new FormData();
    form.set("caseId", "case_1");
    form.set("customerId", "cus_1");
    form.set("providerId", "prov_a");
    form.set("policyNo", "POL-1");
    form.set("startAt", "2026-09-01");
    form.set("endAt", "2027-08-31");
    form.set("premiumMinor", "500000");
    form.set("currency", "AED");
    return form;
  };

  it("builds exactly the not-null columns the contract needs", () => {
    const built = policyFrom(full());
    expect(built).toEqual({
      body: {
        caseId: "case_1",
        customerId: "cus_1",
        providerId: "prov_a",
        policyNo: "POL-1",
        startAt: Date.parse("2026-09-01T00:00:00Z"),
        endAt: Date.parse("2027-08-31T00:00:00Z"),
        premiumMinor: 500_000,
        currency: "AED"
      }
    });
  });

  it("refuses cover that ends before it starts", () => {
    const form = full();
    form.set("endAt", "2026-08-01");
    expect(policyFrom(form)).toEqual({ code: "bad_dates" });
  });

  it("refuses a contract missing its number, customer or either date", () => {
    for (const field of ["policyNo", "customerId", "startAt", "endAt"]) {
      const form = full();
      form.set(field, "");
      expect(policyFrom(form), field).toEqual({ code: "missing_policy" });
    }
  });

  it("refuses to invent the money when the quote fields are gone", () => {
    const form = full();
    form.delete("premiumMinor");
    expect(policyFrom(form)).toEqual({ code: "missing_quote" });
  });
});

describe("issue", () => {
  it("creates the contract from the picked quote", async () => {
    const calls = stubFetch(new Response(JSON.stringify({ id: "pol_1" }), { status: 201 }));
    const form = new FormData();
    form.set("intent", "issue");
    form.set("caseId", "case_1");
    form.set("customerId", "cus_1");
    form.set("providerId", "prov_a");
    form.set("policyNo", "POL-1");
    form.set("startAt", "2026-09-01");
    form.set("endAt", "2027-08-31");
    form.set("premiumMinor", "500000");
    form.set("currency", "AED");

    const result = await action(args(form));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.done).toBe("issue");
  });

  // Binding is the platform's own `axis.bind` approval. Reporting success here
  // would tell an operator a contract exists when only a request does.
  it("surfaces the binding approval gate instead of claiming the contract exists", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "axis.bind"
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );
    const form = new FormData();
    form.set("intent", "issue");
    form.set("caseId", "case_1");
    form.set("customerId", "cus_1");
    form.set("providerId", "prov_a");
    form.set("policyNo", "POL-1");
    form.set("startAt", "2026-09-01");
    form.set("endAt", "2027-08-31");
    form.set("premiumMinor", "500000");
    form.set("currency", "AED");

    const result = await action(args(form));

    expect(result.done).toBeNull();
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("unknown intent", () => {
  it("is a 400 and touches nothing", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const form = new FormData();
    form.set("intent", "bind-everything");

    const result = await action(args(form));

    expect(result.problem?.status).toBe(400);
    expect(result.problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});

describe("phrase", () => {
  it("swaps a known code for this screen's sentence and leaves others alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "bad_dates", status: 400, code: "bad_dates" }, l).title).toBe(
      l("problem.bad_dates")
    );
    expect(phrase({ title: "duplicate policy number", status: 409, code: "conflict" }, l).title).toBe(
      "duplicate policy number"
    );
  });
});

describe("the cases on the desk", () => {
  it("are the ones out with providers, not the closed ones", () => {
    expect([...OPEN_CASE_STATUSES]).toEqual(["quoting", "review", "approval"]);
    expect(OPEN_CASE_STATUSES).not.toContain("issued");
    expect(OPEN_CASE_STATUSES).not.toContain("cancelled");
  });
});

// The issue form asked for the customer as a pasted `cu_01KE…`, so the desk
// offers the customers it already has by name.
describe("deskCustomers", () => {
  it("offers a named customer once, however many cases they have open", () => {
    const cases = [
      kase({ id: "case_1", customerId: "cu_1" }),
      kase({ id: "case_2", customerId: "cu_1" })
    ];

    expect(deskCustomers(cases, { cu_1: "Amina Haddad" })).toEqual([
      { id: "cu_1", label: "Amina Haddad" }
    ]);
  });

  it("leaves out a customer the actor may not read rather than offering a ULID", () => {
    expect(deskCustomers([kase({ customerId: "cu_1" })], {})).toEqual([]);
  });

  it("skips a case that has no customer yet", () => {
    expect(deskCustomers([kase({ customerId: null })], { cu_1: "Amina Haddad" })).toEqual([]);
  });
});
