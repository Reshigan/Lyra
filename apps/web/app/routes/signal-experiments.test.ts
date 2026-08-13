import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  crossedBoundary,
  labelsIn,
  metricLabel,
  nextExperimentStates,
  resultOf,
  samplePct,
  samplesSeen,
  variantsOf,
  verdictTone,
  type ExperimentRow
} from "./signal.shared";
import { action } from "./signal-experiments";

// The experiment log. Two things are worth asserting: the derivations, because
// the stopping line and the sample progress exist nowhere but this screen, and
// the decide write, because nothing else in the platform ever writes
// `signal_experiments.resultJson` — a decision that dropped the reading it was
// merged into would lose the only copy.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...replies: Response[]) {
  const calls: Array<{ url: string; method: string; body: string | null; key: string | null }> = [];
  let at = 0;
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      key: headers.get("idempotency-key")
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
    request: new Request("https://web.test/signal/experiments", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const form = (fields: Record<string, string>): FormData => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
};

const row = (over: Partial<ExperimentRow> = {}): ExperimentRow => ({
  id: "exp_1",
  campaignId: "cmp_1",
  hypothesis: "A shorter quote form lifts starts",
  variantsJson: [
    { key: "control", label: "Long form", splitBps: 5_000 },
    { key: "challenger", label: "Three fields", splitBps: 5_000 }
  ],
  metric: "quote_start_rate",
  minSample: 4_000,
  state: "concluded",
  resultJson: {
    verdict: "won",
    winner: "challenger",
    samples: { control: 2_010, challenger: 1_990 },
    rateBps: { control: 1_200, challenger: 1_540 },
    upliftBps: 340,
    probabilityToBeatControlBps: 9_820,
    stoppedBy: "sequential_boundary",
    note: "Shipped to everyone"
  },
  concludedAt: 1_770_000_000_000,
  createdAt: 1_760_000_000_000,
  updatedAt: 1_770_000_000_000,
  ...over
});

/* ------------------------------------------------------------- derivations */

describe("experiment derivations", () => {
  it("reads a bare array of arms and a wrapped one alike", () => {
    expect(variantsOf(row()).map((v) => v.key)).toEqual(["control", "challenger"]);
    expect(variantsOf(row({ variantsJson: { variants: [{ key: "a" }] } })).map((v) => v.key)).toEqual(["a"]);
    expect(variantsOf(row({ variantsJson: null }))).toEqual([]);
  });

  it("parses the reading, and reports none when the test is still open", () => {
    expect(resultOf(row())?.winner).toBe("challenger");
    expect(resultOf(row({ resultJson: null }))).toBeNull();
    // The column arrives as text from D1 and parsed from the API; both read.
    expect(resultOf(row({ resultJson: '{"verdict":"lost"}' }))?.verdict).toBe("lost");
  });

  it("counts observations across every arm", () => {
    expect(samplesSeen(resultOf(row()))).toBe(4_000);
    expect(samplesSeen(null)).toBe(0);
  });

  it("shows progress against the minimum sample, capped at 100", () => {
    expect(samplePct(row())).toBe(100);
    expect(samplePct(row({ minSample: 8_000 }))).toBe(50);
    expect(samplePct(row({ minSample: 1_000 }))).toBe(100);
    expect(samplePct(row({ minSample: null }))).toBeNull();
  });

  it("only ever moves a test forward", () => {
    expect(nextExperimentStates("draft")).toEqual(["running", "abandoned"]);
    expect(nextExperimentStates("running")).toEqual(["concluded", "abandoned"]);
    expect(nextExperimentStates("concluded")).toEqual([]);
    expect(nextExperimentStates("nonsense")).toEqual([]);
  });

  it("calls the stopping line at 95%, not near it", () => {
    expect(crossedBoundary(resultOf(row()))).toBe(true);
    expect(crossedBoundary({ probabilityToBeatControlBps: 9_500 })).toBe(true);
    expect(crossedBoundary({ probabilityToBeatControlBps: 9_499 })).toBe(false);
    expect(crossedBoundary({})).toBe(false);
    expect(crossedBoundary(null)).toBe(false);
  });

  it("tones the verdict", () => {
    expect(verdictTone(row())).toBe("success");
    expect(verdictTone(row({ resultJson: { verdict: "lost" } }))).toBe("danger");
    expect(verdictTone(row({ resultJson: { verdict: "inconclusive" } }))).toBe("warning");
    expect(verdictTone(row({ resultJson: { verdict: "abandoned" } }))).toBe("neutral");
    expect(verdictTone(row({ resultJson: null }))).toBe("info");
  });

  it("names a metric this pack knows, and title-cases one it does not", () => {
    const l = labelsIn("en");
    expect(metricLabel("quote_start_rate", l)).toBe("Quote start rate");
    expect(metricLabel("newsletter_signup_rate", l)).toBe("Newsletter Signup Rate");
  });
});

/* ------------------------------------------------------------------ action */

describe("experiment action", () => {
  it("refuses a decision without a test, a state or a verdict, before calling the API", async () => {
    const calls = stubFetch(json({}));
    const missing = await action(args(form({ intent: "decide", from: "running", state: "concluded" })));
    expect(missing.problem?.code).toBe("experiment_required");

    const sideways = await action(
      args(form({ intent: "decide", experimentId: "exp_1", from: "concluded", state: "running" }))
    );
    expect(sideways.problem?.code).toBe("state_required");

    const unjudged = await action(
      args(form({ intent: "decide", experimentId: "exp_1", from: "running", state: "concluded", verdict: "" }))
    );
    expect(unjudged.problem?.code).toBe("verdict_required");
    expect(calls).toHaveLength(0);
  });

  it("merges the decision into the reading rather than replacing it", async () => {
    const calls = stubFetch(json({ id: "exp_1" }));
    const result = await action(
      args(
        form({
          intent: "decide",
          key: "idem-1",
          experimentId: "exp_1",
          from: "running",
          state: "concluded",
          verdict: "won",
          winner: "challenger",
          note: "Shipped to everyone",
          result: JSON.stringify({ samples: { control: 10 }, probabilityToBeatControlBps: 9_820 })
        })
      )
    );
    expect(result.problem).toBeNull();
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.key).toBe("idem-1");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.state).toBe("concluded");
    expect(body.concludedAt).toBeGreaterThan(0);
    // The measurement survives the decision.
    expect(body.resultJson).toMatchObject({
      samples: { control: 10 },
      probabilityToBeatControlBps: 9_820,
      verdict: "won",
      winner: "challenger",
      note: "Shipped to everyone"
    });
  });

  it("clears the reading when a test goes back to running", async () => {
    const calls = stubFetch(json({ id: "exp_1" }));
    await action(args(form({ intent: "decide", experimentId: "exp_1", from: "draft", state: "running" })));
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body).toMatchObject({ state: "running", concludedAt: null, resultJson: null });
  });

  it("files an abandonment under its reason, not a note", async () => {
    const calls = stubFetch(json({ id: "exp_1" }));
    await action(
      args(
        form({
          intent: "decide",
          experimentId: "exp_1",
          from: "running",
          state: "abandoned",
          verdict: "abandoned",
          winner: "challenger",
          note: "Audience too small to ever read"
        })
      )
    );
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.resultJson.reason).toBe("Audience too small to ever read");
    expect(body.resultJson.winner).toBeNull();
    expect(body.resultJson.note).toBeUndefined();
  });

  it("refuses a test with no hypothesis, no metric or one arm", async () => {
    const calls = stubFetch(json({}));
    expect((await action(args(form({ intent: "create", hypothesis: "short" })))).problem?.code).toBe(
      "hypothesis_required"
    );
    expect(
      (await action(args(form({ intent: "create", hypothesis: "A shorter form lifts starts", metric: "" }))))
        .problem?.code
    ).toBe("metric_required");
    expect(
      (
        await action(
          args(
            form({
              intent: "create",
              hypothesis: "A shorter form lifts starts",
              metric: "quote_start_rate",
              control: "Long form",
              challenger: ""
            })
          )
        )
      ).problem?.code
    ).toBe("arms_required");
    expect(calls).toHaveLength(0);
  });

  it("starts a test with an even two-arm split", async () => {
    const calls = stubFetch(json({ id: "exp_2" }, 201));
    const result = await action(
      args(
        form({
          intent: "create",
          key: "idem-2",
          hypothesis: "A shorter quote form lifts starts",
          metric: "quote_start_rate",
          minSample: "4000",
          campaignId: "",
          control: "Long form",
          challenger: "Three fields"
        })
      )
    );
    expect(result.done).toBe("created");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBe("idem-2");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body).toMatchObject({ metric: "quote_start_rate", minSample: 4_000, campaignId: null });
    expect(body.variantsJson).toEqual([
      { key: "control", label: "Long form", splitBps: 5_000 },
      { key: "challenger", label: "Three fields", splitBps: 5_000 }
    ]);
  });

  it("refuses an intent it does not know", async () => {
    const calls = stubFetch(json({}));
    expect((await action(args(form({ intent: "delete" })))).problem?.code).toBe("bad_intent");
    expect(calls).toHaveLength(0);
  });
});
