import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Env } from "../env";
import { action, loader } from "./scout-radar";
import {
  CommentaryGhost,
  WS_LABELS,
  commentaryLabels,
  statusOf,
  unreadable,
  type WhitespaceCommentary
} from "../components/whitespace-commentary";
import type { ClusterRow, Page, WhitespaceRow } from "./scout.shared";

// The radar's own logic is the hover commentary — read once by the loader, not
// on hover — and the conversion of a theme into a campaign, which is
// consequential and therefore may come back queued rather than done.

const l = commentaryLabels("en");

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

const page = <T,>(data: T[]): Page<T> => ({ data, total: data.length });

function actionArgs(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/scout/radar", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

function loaderArgs(url = "https://web.test/scout/radar"): LoaderFunctionArgs {
  return {
    request: new Request(url),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as LoaderFunctionArgs;
}

const form = (fields: Record<string, string>): FormData => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
};

const cluster: ClusterRow = {
  id: "clu_1",
  theme: "Agency repair lost at renewal",
  summary: "Three quarters of the churn cites the repair network.",
  momentumScore: 71,
  size: 34,
  firstSeen: 1_760_000_000_000,
  lastSeen: 1_770_000_000_000,
  trailJson: null,
  updatedAt: 1_770_000_000_000
};

const whitespace: WhitespaceRow = {
  id: "wsp_1",
  description: "A motor renewal that keeps agency repair",
  category: "motor",
  clusterId: "clu_1",
  evidenceRefsJson: JSON.stringify({ refs: ["clu_1"] }),
  demandEstimate: 2400,
  competitionScore: 30,
  status: "validated",
  owner: null,
  promotedAt: null,
  createdAt: 1_760_000_000_000,
  updatedAt: 1_770_000_000_000
};

// The shape apps/api/src/engines/scout-whitespace.ts actually serves. It is
// spelled out here rather than shortened because this fixture is the only thing
// standing between the component and a contract nobody serves — an earlier one
// described a `stance`, a `note` and a `confidence`, all three of which read
// `undefined` against the real endpoint while these tests stayed green.
const commentary = (over: Partial<WhitespaceCommentary> = {}): WhitespaceCommentary => ({
  whitespaceId: "wsp_1",
  category: "motor",
  status: "validated",
  commentary: "Demand is firm and only one rival covers it.",
  evidence: { category: "motor", momentum: 78, coverage: 2400, competitionScore: 30, signalCount: 34 },
  why: [
    "Category: motor",
    "Demand momentum score (0-100): 78",
    "Active policies on the book for this category: 2400",
    "Competition score (0-100, share of the panel that bids): 30",
    "Demand signals behind this candidate: 34"
  ],
  ai: {
    marker: "\u2726",
    auditId: "aud_9",
    model: "claude-sonnet-5",
    provider: "anthropic",
    tier: "cloud",
    at: 1_770_000_000_000
  },
  suppressed: false,
  ...over
});

/** Below the k-anonymity floor: the server nulls the sentence and the evidence. */
const suppressed = (): WhitespaceCommentary =>
  commentary({ commentary: null, evidence: null, why: [], ai: null, suppressed: true });

/* ----------------------------------------------------------------- status */

describe("statusOf", () => {
  it("colours the lifecycle the whitespace sweep actually writes", () => {
    // WHITESPACE_TRANSITIONS in packages/core/src/whitespace.ts. Not a stance
    // and not an opinion: the row's own position in its lifecycle.
    expect(statusOf("candidate")).toEqual({ key: "wc.status.candidate", tone: "info" });
    expect(statusOf("validating")).toEqual({ key: "wc.status.validating", tone: "warning" });
    expect(statusOf("validated")).toEqual({ key: "wc.status.validated", tone: "success" });
    expect(statusOf("parked")).toEqual({ key: "wc.status.parked", tone: "neutral" });
  });

  it("renders a status it does not know rather than guessing at one", () => {
    // The column is text, not an enum: an unknown value is shown neutrally,
    // never recoloured into a verdict nobody wrote.
    expect(statusOf("ship-it")).toEqual({ key: "wc.status.unknown", tone: "neutral" });
    expect(statusOf("")).toEqual({ key: "wc.status.unknown", tone: "neutral" });
  });
});

describe("unreadable", () => {
  it("treats a suppressed row and a missing one the same way", () => {
    expect(unreadable(null)).toBe(true);
    expect(unreadable(suppressed())).toBe(true);
    expect(unreadable(commentary({ commentary: null, suppressed: false }))).toBe(true);
    expect(unreadable(commentary())).toBe(false);
  });
});

/* ----------------------------------------------------------------- labels */

describe("commentary labels", () => {
  it("keeps its en and ar tables on exactly the same keys", () => {
    expect(Object.keys(WS_LABELS.ar ?? {}).sort()).toEqual(Object.keys(WS_LABELS.en ?? {}).sort());
  });

  it("has no untranslated ar string", () => {
    for (const [key, value] of Object.entries(WS_LABELS.ar ?? {})) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toBe(WS_LABELS.en?.[key]);
    }
  });

  it("falls through to the scout catalogue for the keys it does not own", () => {
    expect(l("why")).toBe("Why");
    expect(commentaryLabels("ar")("why")).toBe("السبب");
  });

  it("resolves its own keys and fills their placeholders", () => {
    expect(l("wc.convert")).not.toBe("wc.convert");
    expect(l("wc.drafted", { n: "3" })).toContain("3");
  });
});

/* ------------------------------------------------------------ hover reveal */

describe("CommentaryGhost", () => {
  const html = renderToStaticMarkup(<CommentaryGhost id="wc-wsp_1" commentary={commentary()} l={l} locale="en" />);

  it("is in the markup, and so in the accessibility tree, before any hover", () => {
    // Hover-only information is an accessibility failure (WCAG 2.2 AA): the
    // reveal is a CSS opacity change over an element that is always present and
    // always referenced by the dot's aria-describedby.
    expect(html).toContain('id="wc-wsp_1"');
    expect(html).toContain("Demand is firm and only one rival covers it.");
  });

  it("reveals on focus as well as hover, without waiting on an animation", () => {
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).toContain("group-focus-within:opacity-100");
    // The e2e suite forces prefers-reduced-motion, so the reveal may not depend
    // on a transition completing.
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("carries the evidence behind the sentence, not only the prose", () => {
    // `coverage` is a count of contracts on the book. It used to render as
    // "64%" under the label "Uncovered", which was neither a percentage nor a
    // gap — a number a reader would have acted on.
    expect(html).toContain("2,400");
    expect(html).not.toContain("2,400%");
    expect(html).toContain("On the book");
    expect(html).toContain("Signals read 34");
  });

  it("marks the sentence as a model's only when a model wrote it", () => {
    // docs/15: ✦ is a claim of authorship. fallbackDescription() assembles the
    // deterministic sentence from two figures and carries no `ai`.
    expect(html).toContain("\u2726");
    const fallback = renderToStaticMarkup(
      <CommentaryGhost id="wc-wsp_1" commentary={commentary({ ai: null })} l={l} locale="en" />
    );
    expect(fallback).toContain("Demand is firm and only one rival covers it.");
    expect(fallback).not.toContain("\u2726");
  });

  it("says why it is silent when the floor hides the cell, rather than going blank", () => {
    // A blank card under a dot the reader can still see reads as "no view";
    // the truth is "too few people to describe". The dot's aria-describedby
    // points here either way, so it may not point at nothing.
    const hidden = renderToStaticMarkup(
      <CommentaryGhost id="wc-wsp_1" commentary={suppressed()} l={l} locale="en" />
    );
    expect(hidden).toContain('id="wc-wsp_1"');
    expect(hidden).toContain(l("wc.suppressed"));
    expect(hidden).not.toContain("\u2726");
  });

  it("never becomes a hover target of its own", () => {
    expect(html).toContain("pointer-events-none");
  });

  it("says nothing rather than inventing a reading when there is none", () => {
    expect(renderToStaticMarkup(<CommentaryGhost id="wc-wsp_1" commentary={null} l={l} locale="en" />)).toBe("");
  });
});

/* ----------------------------------------------------------------- loader */

describe("radar loader", () => {
  it("prefetches the commentary beside the two reads it already makes", async () => {
    const calls = stubFetch(json(page([cluster])), json(page([whitespace])), json(page([commentary()])));
    const loaded = await loader(loaderArgs());

    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "GET"]);
    expect(calls.some((call) => call.url.includes("/v1/scout/whitespaces/commentary"))).toBe(true);
    // Attached to the dot, so hovering fetches nothing.
    expect(loaded.dots[0]?.commentary?.commentary).toBe(commentary().commentary);
    expect(loaded.commentary?.whitespaceId).toBe("wsp_1");
  });

  it("costs one commentary, not the page, when the read is withheld", async () => {
    stubFetch(json(page([cluster])), json(page([whitespace])), json({ title: "Forbidden", status: 403 }, 403));
    const loaded = await loader(loaderArgs());

    expect(loaded.dots).toHaveLength(1);
    expect(loaded.dots[0]?.commentary).toBeNull();
    expect(loaded.commentary).toBeNull();
  });
});

/* ----------------------------------------------------------------- action */

describe("converting a theme into a campaign", () => {
  it("refuses without a theme, before any call", async () => {
    const calls = stubFetch();
    const result = await action(actionArgs(form({ intent: "promote-signal" })));
    expect(result.problem?.code).toBe("whitespace_required");
    expect(calls).toHaveLength(0);
  });

  it("hands the theme over under the load's idempotency key, so a double click is one campaign", async () => {
    const calls = stubFetch(json({ state: "committed", campaignId: "cmp_1", drafts: 3 }));
    const result = await action(actionArgs(form({ intent: "promote-signal", whitespaceId: "wsp_1", key: "idem_1" })));

    expect(calls[0]?.url).toBe("https://api.test/v1/scout/whitespaces/wsp_1/promote-to-signal");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.key).toBe("idem_1");
    expect(result.done).toEqual({ intent: "promote-signal", state: "committed", campaignId: "cmp_1", drafts: 3 });
  });

  it("reads the approval gate as a queued conversion, not a failure", async () => {
    stubFetch(
      json(
        {
          title: "Approval required",
          status: 403,
          code: "approval_required",
          policy_key: "scout.whitespace_promote"
        },
        403
      )
    );
    const result = await action(actionArgs(form({ intent: "promote-signal", whitespaceId: "wsp_1" })));

    expect(result.problem?.code).toBe("approval_required");
    expect(result.problem?.policy_key).toBe("scout.whitespace_promote");
    expect(result.done).toBeNull();
  });

  it("reports a conversion the API queued for approval as queued, never as done", async () => {
    stubFetch(json({ state: "pending_approval", campaignId: null, drafts: 0 }));
    const result = await action(actionArgs(form({ intent: "promote-signal", whitespaceId: "wsp_1" })));

    expect(result.done).toEqual({
      intent: "promote-signal",
      state: "pending_approval",
      campaignId: null,
      drafts: 0
    });
  });
});
