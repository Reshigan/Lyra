import { flowPlan } from "@lyra/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  LABELS,
  PERM,
  POLICY_FLOW,
  POLICY_TRANSITIONS,
  action,
  labelsIn,
  loader,
  policyLede,
  stateOfAudit
} from "./policy-detail";

// This screen reads. Its one historic bug (F5) was reading the wrong thing:
// "endorsement history" asked for every other contract the same holder owns,
// which is a different question and leaked one customer's book into another
// contract's page. The versions of an agreement have their own resource.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const POLICY = {
  id: "pol_1",
  customerId: "cus_1",
  providerId: "prv_1",
  policyNo: "POL-1",
  startAt: 1_750_000_000_000,
  endAt: 1_780_000_000_000,
  premiumMinor: 120_000,
  currency: "AED",
  commissionMinor: 12_000,
  status: "active",
  createdAt: 1_750_000_000_000,
  updatedAt: 1_750_000_000_000
};

const VERSION = {
  id: "pvr_2",
  versionSeq: 2,
  endorsementNo: "POL-1/E1",
  reason: "vehicle swapped",
  reasonCode: "endorsement",
  effectiveFrom: 1_760_000_000_000,
  effectiveTo: 1_780_000_000_000,
  premiumMinor: 132_000,
  premiumDeltaMinor: 12_000,
  currency: "AED",
  state: "effective",
  issuedAt: 1_760_000_000_000,
  createdAt: 1_760_000_000_000
};

/** Every request the loader makes, in order, answered by path. */
function stubApi(permissions: string[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions }));
    if (url.endsWith("/v1/axis/policies/pol_1")) return Promise.resolve(json(POLICY));
    if (url.endsWith("/v1/axis/policies/pol_1/versions")) {
      return Promise.resolve(json({ data: [VERSION], total: 1 }));
    }
    return Promise.resolve(json({ data: [] }));
  });
  return calls;
}

function args(): LoaderFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/detail"),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "pol_1" }
  } as unknown as LoaderFunctionArgs;
}

/** Every request an action makes, in order, answered by the same reply. */
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

function actionArgs(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/policies/pol_1/detail", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "pol_1" }
  } as unknown as ActionFunctionArgs;
}

function form(fields: Record<string, string>) {
  const body = new FormData();
  body.set("idempotencyKey", "key-1");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

const ok = () => new Response(JSON.stringify({ id: "pol_1" }), { status: 200, headers: { "content-type": "application/json" } });

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

  it("answers the chrome Gate needs, with the rule interpolated", () => {
    expect(labelsIn("en")("approvalBody", { policy: "axis.bind" })).toContain("axis.bind");
    expect(labelsIn("ar")("approvalTitle")).toBeTruthy();
  });

  it("renames the agreement noun for a non-insurance pack", () => {
    expect(labelsIn("en", "retail-ecom")("policies")).not.toBe(labelsIn("en")("policies"));
  });

  it("does not describe the history as the holder's, which is the bug it had", () => {
    for (const locale of ["en", "ar"]) expect(labelsIn(locale)("historyCaption")).not.toContain("holder");
    expect(labelsIn("en")("historyCaption")).toContain("this agreement");
  });
});

describe("policyLede", () => {
  it("states the status and cover term from the loaded record", () => {
    const lede = policyLede(POLICY, labelsIn("en"), "en");
    expect(lede).toContain("Active");
    expect(lede).toContain("2025");
    expect(lede).toContain("2026");
  });

  /**
   * `z.number().int()` is a *safe*-integer check, so before `InstantMs` landed
   * the band (8.64e15, 9.007e15] was an accepted `endAt` — and those rows are
   * still in `axis_policies`. `Intl.DateTimeFormat.format` throws `RangeError`
   * on the Invalid Date such a value makes, this lede is built during the
   * route's own render, and a throw there takes the whole policy page to the
   * error boundary. One unreadable field must not cost the contract.
   */
  it("survives a stored instant no Date can hold", () => {
    const lede = policyLede({ ...POLICY, endAt: 9e15 }, labelsIn("en"), "en");
    expect(lede).toContain("Active");
    expect(lede).toContain("—");
  });
});

describe("loader", () => {
  it("endorsement history shows only versions of this policy", async () => {
    const calls = stubApi(Object.values(PERM));

    const loaded = await loader(args());

    expect(calls).toContain("https://api.test/v1/axis/policies/pol_1/versions");
    // The F5 regression: no request may ask for a holder's other contracts.
    for (const url of calls) expect(url, url).not.toContain("customerId=");
    expect(loaded.versions).toEqual([VERSION]);
  });

  it("degrades the version panel rather than the page when it is refused", async () => {
    vi.stubGlobal("fetch", (input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) return Promise.resolve(json({ permissions: Object.values(PERM) }));
      if (url.endsWith("/v1/axis/policies/pol_1")) return Promise.resolve(json(POLICY));
      if (url.endsWith("/versions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ title: "forbidden", status: 403 }), {
            status: 403,
            headers: { "content-type": "application/json" }
          })
        );
      }
      return Promise.resolve(json({ data: [] }));
    });

    const loaded = await loader(args());

    expect(loaded.policy?.id).toBe("pol_1");
    expect(loaded.versions).toEqual([]);
  });

  it("offers a change only to an actor who may make it", async () => {
    stubApi(["axis:policies:read", "axis:policies:cancel"]);

    const loaded = await loader(args());

    expect(loaded.may).toMatchObject({ read: true, cancel: true, endorse: false, renew: false, financing: false });
  });

  it("offers the financing plan only to an actor who holds axis:policies:finance", async () => {
    stubApi(["axis:policies:read", "axis:policies:finance"]);

    const loaded = await loader(args());

    expect(loaded.may.financing).toBe(true);
  });

  it("hands every write form the same idempotency key for this page load", async () => {
    stubApi(Object.values(PERM));

    const loaded = await loader(args());

    expect(loaded.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("action: reprice", () => {
  it("reprices the policy against telemetry with no body", async () => {
    const calls = stubFetch(
      new Response(
        JSON.stringify({ repriced: true, premiumMinor: 132_000, premiumDeltaPpm: 100_000 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await action(actionArgs(form({ intent: "reprice" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/reprice");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({});
    expect(calls[0]?.idempotencyKey).toBe("key-1:reprice");
    expect(result.done).toBe("repriceDone");
    expect(result.problem).toBeNull();
  });

  it("still reports done when telemetry found nothing worth repricing for", async () => {
    stubFetch(new Response(JSON.stringify({ repriced: false }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    const result = await action(actionArgs(form({ intent: "reprice" })));

    expect(result.done).toBe("repriceDone");
  });

  it("surfaces the sign-off refusal instead of pretending the premium moved", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "axis.policy_endorse"
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    const result = await action(actionArgs(form({ intent: "reprice" })));

    expect(result.problem?.status).toBe(403);
    expect(result.done).toBeNull();
  });
});

describe("action: finance-plan", () => {
  const validFields = {
    intent: "finance-plan",
    financierRef: "fin_1",
    totalMinor: "600000",
    currency: "AED",
    instalments: "12",
    startAt: "2026-09-01",
    frequencyDays: "30",
    commissionMinor: "6000",
    commissionTaxMinor: "300"
  };

  it("creates a premium financing plan, sending epoch millis for the start date", async () => {
    const calls = stubFetch(ok());

    const result = await action(actionArgs(form(validFields)));

    expect(calls[0]?.url).toBe("https://api.test/v1/axis/policies/pol_1/premium-financing-plan");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      financierRef: "fin_1",
      totalMinor: 600_000,
      currency: "AED",
      instalments: 12,
      startAt: Date.parse("2026-09-01T00:00:00Z"),
      frequencyDays: 30,
      commissionMinor: 6_000,
      commissionTaxMinor: 300
    });
    expect(calls[0]?.idempotencyKey).toBe("key-1:finance-plan:600000");
    expect(result.done).toBe("financeDone");
  });

  it("omits the optional financier and tax fields rather than sending them empty", async () => {
    const calls = stubFetch(ok());
    const { financierRef: _financierRef, commissionTaxMinor: _commissionTaxMinor, ...rest } = validFields;

    await action(actionArgs(form(rest)));

    const sent = JSON.parse(calls[0]!.body!);
    expect(sent).not.toHaveProperty("financierRef");
    expect(sent).not.toHaveProperty("commissionTaxMinor");
  });

  it("refuses a plan with no currency", async () => {
    const calls = stubFetch(ok());
    const { currency: _currency, ...rest } = validFields;

    const result = await action(actionArgs(form(rest)));

    expect(calls).toHaveLength(0);
    expect(result.error).toBe("financeCurrencyRequired");
  });

  it("refuses a non-positive total or commission", async () => {
    const calls = stubFetch(ok());

    const result = await action(actionArgs(form({ ...validFields, totalMinor: "0" })));

    expect(calls).toHaveLength(0);
    expect(result.error).toBe("financeAmountRequired");
  });

  it("refuses a negative commission tax", async () => {
    const calls = stubFetch(ok());

    const result = await action(actionArgs(form({ ...validFields, commissionTaxMinor: "-1" })));

    expect(calls).toHaveLength(0);
    expect(result.error).toBe("financeAmountRequired");
  });

  it("refuses a schedule with no instalments, no frequency or an unparsable start date", async () => {
    const calls = stubFetch(ok());

    const result = await action(actionArgs(form({ ...validFields, instalments: "0" })));

    expect(calls).toHaveLength(0);
    expect(result.error).toBe("financeScheduleRequired");

    const badStart = await action(actionArgs(form({ ...validFields, startAt: "not-a-date" })));
    expect(badStart.error).toBe("financeScheduleRequired");
  });
});

// The diagram is only as true as the machine it is handed, and the history it
// draws is only as true as the trail it reads. These pin both.

describe("POLICY_FLOW", () => {
  it("is the screen's machine by reference, not a second copy of it", () => {
    expect(POLICY_FLOW.transitions).toBe(POLICY_TRANSITIONS);
  });

  it("names no state the machine does not document", () => {
    for (const state of [...POLICY_FLOW.spine, ...(POLICY_FLOW.exits ?? [])]) {
      expect(POLICY_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("draws every state the machine documents, on the spine or off it", () => {
    // A status the API can hold that the diagram cannot place is a page that
    // silently loses the agreement it is describing.
    const drawn = new Set([...POLICY_FLOW.spine, ...(POLICY_FLOW.exits ?? [])]);
    expect([...drawn].sort()).toEqual(Object.keys(POLICY_TRANSITIONS).sort());
  });

  it("is a spine of documented transitions, whole", () => {
    // `flowPlan` throws on an undocumented spine edge, so this both plans and
    // proves the happy path is one the lifecycle engine can actually walk.
    const plan = flowPlan(POLICY_FLOW, [], "draft");
    expect(plan.steps.map((step) => step.state)).toEqual([...POLICY_FLOW.spine]);
    expect(plan.unknown).toEqual([]);
  });

  it("can draw every state the machine can reach", () => {
    for (const state of Object.keys(POLICY_TRANSITIONS)) {
      const plan = flowPlan(POLICY_FLOW, [{ state }], state);
      expect(plan.steps.map((step) => step.state)).toContain(state);
      expect(plan.unknown).toEqual([]);
    }
  });

  it("never tells a live agreement it is pending its own lapse or expiry", () => {
    for (const state of POLICY_FLOW.spine) {
      const plan = flowPlan(POLICY_FLOW, [], state);
      for (const exit of POLICY_FLOW.exits ?? []) {
        expect(plan.steps.map((step) => step.state)).not.toContain(exit);
      }
    }
  });

  it("promises nothing further once an agreement is renewed, cancelled or never taken up", () => {
    for (const state of ["renewed", "cancelled", "ntu"]) {
      const plan = flowPlan(POLICY_FLOW, [{ state }], state);
      expect(plan.steps.filter((step) => step.status === "pending")).toEqual([]);
    }
  });

  it("offers a lapsed agreement reinstatement, because the machine documents it", () => {
    const plan = flowPlan(POLICY_FLOW, [{ state: "active" }], "lapsed");
    expect(plan.steps.map((step) => step.state)).toEqual(["active", "lapsed", "active"]);
  });

  it("offers an expired agreement the late renewal inside the grace window", () => {
    const plan = flowPlan(POLICY_FLOW, [{ state: "expired" }], "expired");
    expect(plan.steps.map((step) => step.state)).toEqual(["expired", "renewed"]);
  });
});

describe("stateOfAudit", () => {
  it("reads a state out of the verb the lifecycle engine wrote", () => {
    // The trail records what was done, not where it landed, so every verb has
    // to be mapped: `cancel` lands on `cancelled`, `incept` on `active`.
    expect(stateOfAudit("axis.policy.bind")).toBe("bound");
    expect(stateOfAudit("axis.policy.bind_group")).toBe("bound");
    expect(stateOfAudit("axis.policy.incept")).toBe("active");
    expect(stateOfAudit("axis.policy.reinstate")).toBe("active");
    expect(stateOfAudit("axis.policy.lapse")).toBe("lapsed");
    expect(stateOfAudit("axis.policy.cancel")).toBe("cancelled");
    expect(stateOfAudit("axis.policy.expire")).toBe("expired");
    expect(stateOfAudit("axis.policy.renew")).toBe("renewed");
    expect(stateOfAudit("axis.policy.ntu")).toBe("ntu");
  });

  it("only names states the machine documents", () => {
    for (const verb of ["bind", "bind_group", "incept", "reinstate", "lapse", "cancel", "expire", "renew", "ntu"]) {
      const state = stateOfAudit(`axis.policy.${verb}`);
      expect(state).not.toBeNull();
      expect(POLICY_TRANSITIONS[state as string]).toBeDefined();
    }
  });

  it("is not a state change for anything else on the trail", () => {
    for (const entry of [
      // These change an agreement without moving it.
      "axis.policy.endorse",
      "axis.policy.document_issued",
      "axis.policy.refer",
      "axis.policy.broker_fee",
      // A resulting state is not a verb: the engine never writes these.
      "axis.policy.bound",
      "axis.policy.active",
      "axis.claim.assessing",
      "axis.case.quoting",
      "core.approval.decided",
      "axis.policy.",
      ""
    ]) {
      expect(stateOfAudit(entry)).toBeNull();
    }
  });
});
