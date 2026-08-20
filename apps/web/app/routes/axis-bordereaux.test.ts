import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  BORDEREAU_KINDS,
  COUNTERPARTY_KINDS,
  DIRECTIONS,
  LABELS,
  action,
  labelsIn,
  loader
} from "./axis-bordereaux";

// AXIS's periodic reconciliation file between us and a provider/channel/
// partner. Generation is idempotent-per-period for outbound and one-shot for
// inbound; reconciliation matches lines against our own policies and never
// overwrites totals a human has already actioned. Neither write PATCHes a
// row directly — both go through apps/api/src/engines/axis-bordereaux.ts.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null; idempotencyKey: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      idempotencyKey: new Headers(init.headers).get("idempotency-key")
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/bordereaux", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  body.set("idempotencyKey", "key-1");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const json = ok;

const BORDEREAU = {
  id: "bdx_1",
  direction: "outbound",
  counterpartyKind: "provider",
  counterpartyId: "prv_1",
  kind: "premium",
  period: "2026-07",
  currency: "AED",
  lineCount: 2,
  grossPremiumMinor: 500_000,
  commissionMinor: 50_000,
  claimsPaidMinor: 0,
  reserveMinor: 0,
  varianceMinor: 0,
  state: "generated",
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000
};

const LINE = {
  id: "bdxl_1",
  bordereauId: "bdx_1",
  lineNo: 1,
  externalRef: "POL-1",
  riskRef: "VIN-1",
  grossPremiumMinor: 100_000,
  commissionMinor: 10_000,
  claimsPaidMinor: 0,
  reserveMinor: 0,
  currency: "AED",
  matchState: "matched",
  varianceMinor: 0,
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000
};

function stubLoader(permissions: string[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions }));
    if (url.includes("/v1/axis/bordereaux?")) return Promise.resolve(json({ data: [BORDEREAU] }));
    if (url.endsWith("/v1/axis/bordereaux/bdx_1")) return Promise.resolve(json(BORDEREAU));
    if (url.includes("/v1/axis/bordereau-lines")) return Promise.resolve(json({ data: [LINE] }));
    return Promise.resolve(json({ data: [] }));
  });
  return calls;
}

function loadArgs(search = ""): LoaderFunctionArgs {
  return {
    request: new Request(`https://web.test/axis/bordereaux${search}`),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

/* ------------------------------------------------------------------- tests */

describe("labelsIn", () => {
  it("answers every key in both languages, and never with the key itself", () => {
    for (const key of Object.keys(LABELS.en!)) {
      expect(LABELS.ar![key], key).toBeTruthy();
      for (const locale of ["en", "ar"]) expect(labelsIn(locale)(key), `${locale}:${key}`).not.toBe(key);
    }
    expect(Object.keys(LABELS.ar!).sort()).toEqual(Object.keys(LABELS.en!).sort());
  });

  it("keeps the Arabic distinct from the English", () => {
    for (const [key, value] of Object.entries(LABELS.en!)) expect(LABELS.ar![key], key).not.toBe(value);
  });

  it("names every direction, counterparty kind and bordereau kind this screen offers", () => {
    for (const direction of DIRECTIONS) expect(labelsIn("en")(`direction.${direction}`), direction).not.toBe(`direction.${direction}`);
    for (const kind of COUNTERPARTY_KINDS)
      expect(labelsIn("en")(`counterpartyKind.${kind}`), kind).not.toBe(`counterpartyKind.${kind}`);
    for (const kind of BORDEREAU_KINDS)
      expect(labelsIn("ar")(`bordereauKind.${kind}`), kind).not.toBe(`bordereauKind.${kind}`);
  });
});

describe("loader", () => {
  it("lists the register, and drills into a selected bordereau's lines when ?id= is given", async () => {
    stubLoader(["axis:bordereaux:read"]);

    const listOnly = await loader(loadArgs());
    expect(listOnly.bordereaux).toHaveLength(1);
    expect(listOnly.selected).toBeNull();
    expect(listOnly.lines).toHaveLength(0);

    const withSelection = await loader(loadArgs("?id=bdx_1"));
    expect(withSelection.selected?.id).toBe("bdx_1");
    expect(withSelection.lines).toHaveLength(1);
    expect(withSelection.lines[0]?.matchState).toBe("matched");
  });

  it("returns nothing when the actor cannot read bordereaux", async () => {
    stubLoader([]);
    const loaded = await loader(loadArgs());
    expect(loaded.bordereaux).toHaveLength(0);
    expect(loaded.may.read).toBe(false);
  });
});

describe("action: generate", () => {
  it("generates an outbound bordereau from the ledger, with no raw lines needed", async () => {
    const calls = stubFetch(ok({ bordereau: BORDEREAU, lines: [] }));

    const result = await action(
      args(
        form({
          intent: "generate",
          direction: "outbound",
          counterpartyKind: "provider",
          counterpartyId: "prv_1",
          kind: "premium",
          period: "2026-07",
          currency: "AED"
        })
      )
    );

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/bordereaux");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      direction: "outbound",
      counterpartyKind: "provider",
      counterpartyId: "prv_1",
      kind: "premium",
      period: "2026-07",
      currency: "AED",
      lines: []
    });
    expect(result.done).toBe("generateDone");
  });

  it("carries the raw lines an inbound bordereau needs, parsed from the form's JSON", async () => {
    const calls = stubFetch(ok({ bordereau: BORDEREAU, lines: [] }));
    const rawLines = [{ externalRef: "POL-1", grossPremiumMinor: 100_000 }];

    const result = await action(
      args(
        form({
          intent: "generate",
          direction: "inbound",
          counterpartyKind: "partner",
          counterpartyId: "ptn_1",
          kind: "combined",
          period: "2026-07",
          currency: "AED",
          lines: JSON.stringify(rawLines)
        })
      )
    );

    expect(JSON.parse(calls[0]!.body!)).toEqual({
      direction: "inbound",
      counterpartyKind: "partner",
      counterpartyId: "ptn_1",
      kind: "combined",
      period: "2026-07",
      currency: "AED",
      lines: rawLines
    });
    expect(result.done).toBe("generateDone");
  });

  it("refuses a direction, counterparty kind or bordereau kind outside the declared sets", async () => {
    const calls = stubFetch(ok({}));
    const base = { intent: "generate", counterpartyId: "prv_1", period: "2026-07", currency: "AED" };

    const badDirection = await action(args(form({ ...base, direction: "sideways", counterpartyKind: "provider", kind: "premium" })));
    expect(badDirection.error).toBe("directionRequired");

    const badCounterparty = await action(args(form({ ...base, direction: "outbound", counterpartyKind: "vibes", kind: "premium" })));
    expect(badCounterparty.error).toBe("counterpartyKindRequired");

    const badKind = await action(args(form({ ...base, direction: "outbound", counterpartyKind: "provider", kind: "vibes" })));
    expect(badKind.error).toBe("kindRequired");

    expect(calls).toHaveLength(0);
  });

  it("refuses a period that is not a real calendar month, and an inbound request with no usable lines", async () => {
    const calls = stubFetch(ok({}));
    const base = {
      intent: "generate",
      direction: "outbound",
      counterpartyKind: "provider",
      counterpartyId: "prv_1",
      kind: "premium",
      currency: "AED"
    };

    for (const period of ["2026-13", "2026-7", "not-a-month", ""]) {
      const result = await action(args(form({ ...base, period })));
      expect(result.error, period).toBe("periodRequired");
    }

    const noLines = await action(
      args(form({ ...base, direction: "inbound", period: "2026-07", lines: "not json" }))
    );
    expect(noLines.error).toBe("linesRequired");

    const emptyLines = await action(args(form({ ...base, direction: "inbound", period: "2026-07", lines: "[]" })));
    expect(emptyLines.error).toBe("linesRequired");

    expect(calls).toHaveLength(0);
  });
});

describe("action: reconcile", () => {
  it("reconciles a named bordereau's lines against our own policies", async () => {
    const calls = stubFetch(ok({ bordereau: BORDEREAU, lines: [LINE] }));

    const result = await action(args(form({ intent: "reconcile", bordereauId: "bdx_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/bordereaux/bdx_1/reconcile");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({});
    expect(result.done).toBe("reconcileDone");
  });

  it("refuses to reconcile with no bordereau named", async () => {
    const calls = stubFetch(ok({}));
    const result = await action(args(form({ intent: "reconcile" })));
    expect(result.error).toBe("bordereauRequired");
    expect(calls).toHaveLength(0);
  });

  it("surfaces the permission refusal instead of pretending the lines were matched", async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "forbidden", status: 403, code: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await action(args(form({ intent: "reconcile", bordereauId: "bdx_1" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});

describe("action: unknown intent", () => {
  it("refuses rather than guessing what was meant", async () => {
    const calls = stubFetch(ok({}));
    const result = await action(args(form({ intent: "nonsense" })));
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
