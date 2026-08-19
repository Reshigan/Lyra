import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action, flagOf, nextWhitespaceStates, wspLede, type SignalRow } from "./scout-whitespace";
import { labelsIn } from "./scout.shared";

const l = labelsIn("en");

// The card is the only screen that moves a whitespace's state, so what is worth
// asserting is that it cannot move one sideways — a target the card cannot
// reach from where it stands never reaches the API — and that the promote stamp
// is written on a promote and on nothing else.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...replies: Response[]) {
  const calls: Array<{ url: string; method: string; key: string | null; body: Record<string, unknown> }> = [];
  let at = 0;
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      key: headers.get("idempotency-key"),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    });
    const reply = replies[Math.min(at, replies.length - 1)] ?? new Response(null, { status: 204 });
    at += 1;
    return Promise.resolve(reply.clone());
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/scout/whitespace/wsp_1", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: { id: "wsp_1" }
  } as unknown as ActionFunctionArgs;
}

const form = (fields: Record<string, string>): FormData => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
};

const signal = (over: Partial<SignalRow> = {}): SignalRow => ({
  id: "sig_1",
  source: "regulatory",
  sourceRef: "rss:insurance-circulars/2025-12-29",
  // `/v1/scout/signals` is generic CRUD, so crud.ts `hydrate()` sends
  // `payloadJson` already parsed. The fixture is that shape.
  payloadJson: {
    title: "New item on the circular feed, health line",
    state: "unread",
    routedTo: "khalid.rashed",
    note: "Flagged for counsel."
  },
  weight: 2,
  observedAt: 1_770_000_000_000,
  ...over
});

/* ------------------------------------------------------------- transitions */

describe("state machine", () => {
  it("moves one step down the funnel, parks from anywhere it can", () => {
    expect(nextWhitespaceStates("candidate")).toEqual(["validating", "parked"]);
    expect(nextWhitespaceStates("validating")).toEqual(["validated", "parked"]);
    expect(nextWhitespaceStates("validated")).toEqual(["promoted", "parked"]);
    expect(nextWhitespaceStates("promoted")).toEqual(["parked"]);
  });

  it("brings a parked card back as a candidate, not to where it was parked from", () => {
    // The evidence has aged while it sat; it re-enters the funnel at the top.
    expect(nextWhitespaceStates("parked")).toEqual(["candidate"]);
  });

  it("offers nothing from a state it does not know", () => {
    // scout_whitespaces.status is text, not an enum. An unknown value is read,
    // rendered and left alone rather than guessed at.
    expect(nextWhitespaceStates("shipped")).toEqual([]);
    expect(nextWhitespaceStates("")).toEqual([]);
  });

  it("never offers a card the state it is already in", () => {
    for (const state of ["candidate", "validating", "validated", "promoted", "parked"]) {
      expect(nextWhitespaceStates(state)).not.toContain(state);
    }
  });
});

/* ------------------------------------------------------------------ flags */

describe("regulatory flags", () => {
  it("reads the harvester's payload without asserting anything about the item", () => {
    const flag = flagOf(signal());
    expect(flag.title).toBe("New item on the circular feed, health line");
    expect(flag.state).toBe("unread");
    expect(flag.routedTo).toBe("khalid.rashed");
    expect(flag.ref).toBe("rss:insurance-circulars/2025-12-29");
  });

  it("falls back to the source reference, then the row id, rather than dropping the flag", () => {
    expect(flagOf(signal({ payloadJson: {} })).title).toBe("rss:insurance-circulars/2025-12-29");
    expect(flagOf(signal({ payloadJson: "not json", sourceRef: null })).title).toBe("sig_1");
    expect(flagOf(signal({ payloadJson: null, sourceRef: null })).title).toBe("sig_1");
  });

  it("ignores payload fields that are not text", () => {
    const flag = flagOf(signal({ payloadJson: { title: 7, state: ["unread"] } }));
    expect(flag.title).toBe("rss:insurance-circulars/2025-12-29");
    expect(flag.state).toBeNull();
  });

  it("survives a payload that is a list rather than a bag", () => {
    expect(flagOf(signal({ payloadJson: [1, 2] })).title).toBe("rss:insurance-circulars/2025-12-29");
  });
});

/* ----------------------------------------------------------------- action */

describe("moving a card", () => {
  it("refuses a move the card cannot make, before any call", async () => {
    const calls = stubFetch();
    const result = await action(
      args(form({ intent: "move", whitespaceId: "wsp_1", from: "candidate", to: "promoted" }))
    );
    expect(result.problem?.code).toBe("transition_required");
    expect(calls).toHaveLength(0);
  });

  it("refuses without a card, and refuses any other intent", async () => {
    const calls = stubFetch();
    expect((await action(args(form({ intent: "move", from: "candidate", to: "parked" })))).problem?.code).toBe(
      "whitespace_required"
    );
    expect((await action(args(form({ intent: "delete" })))).problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });

  it("patches the row and stamps the promotion", async () => {
    const calls = stubFetch(json({ id: "wsp_1", status: "promoted" }));
    const result = await action(
      args(
        form({
          intent: "move",
          whitespaceId: "wsp_1",
          from: "validated",
          to: "promoted",
          owner: "tariq.mansour",
          key: "idem_1"
        })
      )
    );
    expect(calls[0]?.url).toBe("https://api.test/v1/scout/whitespaces/wsp_1");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.key).toBe("idem_1");
    expect(calls[0]?.body.status).toBe("promoted");
    expect(calls[0]?.body.owner).toBe("tariq.mansour");
    expect(typeof calls[0]?.body.promotedAt).toBe("number");
    expect(result.done).toEqual({ intent: "move", status: "promoted" });
  });

  it("stamps nothing on a move that is not a promotion, and leaves a blank owner alone", async () => {
    const calls = stubFetch(json({ id: "wsp_1", status: "parked" }));
    await action(args(form({ intent: "move", whitespaceId: "wsp_1", from: "validated", to: "parked", owner: "  " })));
    expect(calls[0]?.body).toEqual({ status: "parked" });
  });

  it("reads the approval gate as a queued change, not a failure", async () => {
    // scout.whitespace_promote — resources.ts gates every update on this card.
    stubFetch(
      json({ title: "Approval required", status: 403, code: "approval_required", policy_key: "scout.whitespace_promote" }, 403)
    );
    const result = await action(args(form({ intent: "move", whitespaceId: "wsp_1", from: "candidate", to: "parked" })));
    expect(result.problem?.code).toBe("approval_required");
    expect(result.problem?.policy_key).toBe("scout.whitespace_promote");
    expect(result.done).toBeNull();
  });
});

/* ------------------------------------------------------------------- lede */

describe("wspLede", () => {
  it("names both counts when the card has flags and experiments", () => {
    expect(wspLede(2, 3, l)).toBe(l("wsp.ledeBoth", { flags: "2", experiments: "3" }));
  });

  it("names only the flags with no experiments", () => {
    expect(wspLede(2, 0, l)).toBe(l("wsp.ledeFlags", { flags: "2" }));
  });

  it("names only the experiments with no flags", () => {
    expect(wspLede(0, 3, l)).toBe(l("wsp.ledeExperiments", { experiments: "3" }));
  });

  it("falls back to the generic lede with neither", () => {
    expect(wspLede(0, 0, l)).toBe(l("wsp.lede"));
  });
});
