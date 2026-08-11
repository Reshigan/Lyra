import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import type { Env } from "../env";
import {
  EXCEPTION_STATUSES,
  SAMPLE,
  WINDOWS,
  action,
  asPercent,
  cycleStats,
  definitionFor,
  durationIn,
  statusLabel,
  exceptionRate,
  isException,
  labelsIn,
  percentile,
  periodRows,
  phrase,
  slaStats,
  statusRows,
  totalCases,
  windowDays,
  type CaseRow,
  type RunTable
} from "./axis-analytics";

// Every number on this screen is a claim about how the business ran, so the
// arithmetic is what gets pinned: what counts as an exception, what a cycle time
// is measured over, which cases an SLA figure is allowed to judge, and that the
// export goes through the platform pipeline with the window it was asked for.

const env = { ENVIRONMENT: "test", API_ORIGIN: "https://api.test", SESSION_COOKIE: "s" } as Env;
const DAY = 86_400_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(reply: Response) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null
    });
    return Promise.resolve(reply.clone());
  });
  return calls;
}

function args(form: FormData): ActionFunctionArgs {
  return {
    request: new Request("https://web.test/axis/analytics", { method: "POST", body: form }),
    context: { get: () => ({ env, ctx: null }) },
    params: {}
  } as unknown as ActionFunctionArgs;
}

const kase = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: "case_1",
  status: "issued",
  createdAt: 0,
  closedAt: null,
  slaDueAt: null,
  ...over
});

const table = (rows: Record<string, unknown>[]): RunTable => ({ columns: [], rows });

/* ----------------------------------------------------------------- labels */

describe("labelsIn", () => {
  it("translates every key into Arabic", () => {
    const en = labelsIn("en");
    const ar = labelsIn("ar");
    const keys = [
      "title",
      "intro",
      "window",
      "days",
      "stat.throughput",
      "stat.exceptions",
      "stat.cycle",
      "stat.sla",
      "unit.days",
      "unit.hours",
      "byPeriod.title",
      "byPeriod.caption",
      "byPeriod.period",
      "byPeriod.cases",
      "byStatus.title",
      "byStatus.caption",
      "byStatus.status",
      "byStatus.cases",
      "byStatus.share",
      "byStatus.exception",
      "duration.title",
      "duration.caption",
      "duration.closed",
      "duration.median",
      "duration.p90",
      "duration.slaMeasured",
      "duration.slaMet",
      "sample.title",
      "sample.reason",
      "export.title",
      "export.intro",
      "export.format",
      "export.submit",
      "export.download",
      "export.rows",
      "export.failed",
      "empty.title",
      "empty.body",
      "approvalTitle",
      "approvalBody",
      "approvalLink",
      "problem.bad_intent",
      "problem.format_required",
      "problem.hidden"
    ];
    for (const key of keys) {
      expect(en(key), `en ${key}`).not.toBe(key);
      expect(ar(key), `ar ${key}`).not.toBe(key);
      expect(ar(key), `ar ${key} untranslated`).not.toBe(en(key));
    }
  });

  it("interpolates the sample ceiling into the caveat, in both languages", () => {
    for (const locale of ["en", "ar"]) {
      expect(labelsIn(locale)("sample.reason", { n: "200" })).toContain("200");
    }
  });

  it("falls back to English for a locale nobody translated", () => {
    expect(labelsIn("de")("stat.cycle")).toBe(labelsIn("en")("stat.cycle"));
  });
});

/* ----------------------------------------------------------------- window */

describe("windowDays", () => {
  it("accepts only the offered windows", () => {
    for (const days of WINDOWS) expect(windowDays(String(days))).toBe(days);
  });

  it("defaults to a month for anything else", () => {
    for (const bad of [null, "", "0", "-30", "31", "abc", "1e9"]) expect(windowDays(bad)).toBe(30);
  });
});

/* --------------------------------------------------------------- statuses */

describe("statusRows", () => {
  it("orders by size and gives each pile its share", () => {
    const rows = statusRows(
      table([
        { status: "issued", cases: 30 },
        { status: "failed", cases: 10 },
        { status: "quoting", cases: 60 }
      ])
    );
    expect(rows.map((row) => row.status)).toEqual(["quoting", "issued", "failed"]);
    expect(rows.map((row) => row.share)).toEqual([0.6, 0.3, 0.1]);
  });

  it("marks the stalled statuses and only those", () => {
    const rows = statusRows(
      table([
        { status: "failed", cases: 1 },
        { status: "awaiting_docs", cases: 1 },
        { status: "quoting", cases: 1 },
        { status: "issued", cases: 1 }
      ])
    );
    expect(rows.filter((row) => row.exception).map((row) => row.status).sort()).toEqual([
      "awaiting_docs",
      "failed"
    ]);
  });

  it("survives a withheld run and a row with no status", () => {
    expect(statusRows(null)).toEqual([]);
    expect(statusRows(table([{ cases: 3 }]))[0]).toMatchObject({ status: "unknown", cases: 3 });
  });

  it("reads a non-numeric count as zero rather than NaN", () => {
    expect(statusRows(table([{ status: "issued", cases: null }]))[0]?.cases).toBe(0);
  });
});

describe("exceptionRate", () => {
  it("is the stalled share of the window", () => {
    expect(
      exceptionRate(
        statusRows(
          table([
            { status: "failed", cases: 5 },
            { status: "cancelled", cases: 5 },
            { status: "issued", cases: 90 }
          ])
        )
      )
    ).toBe(0.1);
  });

  it("is zero, not NaN, when no work came in", () => {
    expect(exceptionRate([])).toBe(0);
    expect(totalCases([])).toBe(0);
  });

  it("counts every listed exception status", () => {
    for (const status of EXCEPTION_STATUSES) expect(isException(status)).toBe(true);
    expect(isException("issued")).toBe(false);
  });
});

/* ---------------------------------------------------------------- periods */

describe("periodRows", () => {
  it("sorts oldest first and drops a bucket with no period", () => {
    expect(
      periodRows(
        table([
          { period: "2026-03-02", cases: 2 },
          { cases: 9 },
          { period: "2026-03-01", cases: 5 }
        ])
      )
    ).toEqual([
      { period: "2026-03-01", cases: 5 },
      { period: "2026-03-02", cases: 2 }
    ]);
  });

  it("is empty when the run was withheld", () => {
    expect(periodRows(null)).toEqual([]);
  });
});

/* --------------------------------------------------------------- duration */

describe("percentile", () => {
  it("takes the nearest rank and never walks off the end", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(5);
    expect(percentile(sorted, 0.9)).toBe(9);
    expect(percentile(sorted, 1)).toBe(10);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("cycleStats", () => {
  it("measures only the cases that closed", () => {
    const stats = cycleStats([
      kase({ id: "a", createdAt: 0, closedAt: 2 * DAY }),
      kase({ id: "b", createdAt: 0, closedAt: 4 * DAY }),
      // Open for a year: counting it would swamp the median with work in flight.
      kase({ id: "c", createdAt: 0, closedAt: null })
    ]);
    expect(stats.closed).toBe(2);
    expect(stats.medianMs).toBe(2 * DAY);
    expect(stats.p90Ms).toBe(4 * DAY);
  });

  it("ignores a row that closed before it opened", () => {
    expect(cycleStats([kase({ createdAt: 5 * DAY, closedAt: DAY })]).closed).toBe(0);
  });

  it("reports nulls rather than zero when nothing closed", () => {
    expect(cycleStats([kase()])).toEqual({ closed: 0, medianMs: null, p90Ms: null });
  });
});

describe("slaStats", () => {
  const now = 100 * DAY;

  it("judges only cases that had a promised date and reached an end", () => {
    const stats = slaStats(
      [
        kase({ id: "met", slaDueAt: 10 * DAY, closedAt: 9 * DAY }),
        kase({ id: "late", slaDueAt: 10 * DAY, closedAt: 11 * DAY }),
        // Open and past due: already a breach, counts against.
        kase({ id: "overdue", slaDueAt: 10 * DAY, closedAt: null }),
        // Open, due next week: not yet judgeable either way.
        kase({ id: "pending", slaDueAt: 110 * DAY, closedAt: null }),
        // Never promised anything: counting it as met would flatter the number.
        kase({ id: "undated", slaDueAt: null, closedAt: 3 * DAY })
      ],
      now
    );
    expect(stats).toEqual({ measured: 3, met: 1, rate: 1 / 3 });
  });

  it("treats closing exactly on the due date as met", () => {
    expect(slaStats([kase({ slaDueAt: 10 * DAY, closedAt: 10 * DAY })], now).met).toBe(1);
  });

  it("returns a null rate, not zero, when nothing was judgeable", () => {
    expect(slaStats([kase()], now)).toEqual({ measured: 0, met: 0, rate: null });
  });
});

describe("durationIn / asPercent", () => {
  const l = labelsIn("en");

  it("rounds to days above a day and to hours below", () => {
    expect(durationIn(3 * DAY, l)).toBe("3d");
    expect(durationIn(5 * 3_600_000, l)).toBe("5h");
    // Never "0h" — something that took minutes still took time.
    expect(durationIn(60_000, l)).toBe("1h");
    expect(durationIn(null, l)).toBe("—");
  });

  it("shows an em dash for an unmeasurable percentage", () => {
    expect(asPercent(null, "en")).toBe("—");
    expect(asPercent(0.125, "en")).toBe("12.5%");
  });
});

/* --------------------------------------------------------------- exports */

describe("action", () => {
  const form = (over: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ intent: "export", format: "xlsx", days: "30", ...over }))
      data.set(key, value);
    return data;
  };

  it("posts to the platform export pipeline with the window inside the definition", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "exp_1", format: "xlsx", state: "ready", rowCount: 12, error: null }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const result = await action(args(form({ days: "90" })));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.test/v1/analytics/exports");
    expect(calls[0]?.method).toBe("POST");
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.format).toBe("xlsx");
    expect(body.totals).toBe(true);
    expect(body.definition.dataset).toBe("cases");
    expect(body.definition.to - body.definition.from).toBe(90 * DAY);
    expect(result.exported?.id).toBe("exp_1");
    expect(result.problem).toBeNull();
  });

  it("exports the same definition the screen's own numbers are built from", async () => {
    const calls = stubFetch(
      new Response(JSON.stringify({ id: "exp_1", state: "ready" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    await action(args(form()));
    const body = JSON.parse(calls[0]?.body ?? "{}");
    const { from, to } = body.definition;
    expect(body.definition).toEqual(definitionFor(from, to, "none"));
  });

  it("refuses a format the API does not render, without calling it", async () => {
    for (const format of ["", "docx", "html", "XLSX"]) {
      const calls = stubFetch(new Response(null, { status: 204 }));
      const result = await action(args(form({ format })));
      expect(result.problem?.code).toBe("format_required");
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses an intent it does not know, without calling anything", async () => {
    const calls = stubFetch(new Response(null, { status: 204 }));
    const result = await action(args(form({ intent: "delete" })));
    expect(result.problem?.code).toBe("bad_intent");
    expect(result.problem?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("surfaces an approval gate rather than swallowing it", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          title: "approval required",
          status: 403,
          code: "approval_required",
          policy_key: "core.unmasked_export"
        }),
        { status: 403, headers: { "content-type": "application/problem+json" } }
      )
    );
    const result = await action(args(form()));
    expect(result.exported).toBeNull();
    expect(result.problem?.status).toBe(403);
    expect(result.problem?.code).toBe("approval_required");
  });
});

describe("phrase", () => {
  it("says a known refusal in the reader's language and leaves the rest alone", () => {
    const l = labelsIn("en");
    expect(phrase({ title: "raw", status: 400, code: "format_required" }, l).title).toBe(
      l("problem.format_required")
    );
    expect(phrase({ title: "boom", status: 500 }, l).title).toBe("boom");
  });
});

describe("definitionFor", () => {
  it("groups by status without a grain and by day without a dimension", () => {
    expect(definitionFor(1, 2, "none")).toMatchObject({ dimensions: ["status"], grain: "none" });
    expect(definitionFor(1, 2, "day")).toMatchObject({ dimensions: [], grain: "day" });
  });
});

describe("SAMPLE", () => {
  it("stays inside the API's page ceiling", () => {
    expect(SAMPLE).toBeLessThanOrEqual(200);
  });
});

// The "Where the work is" breakdown printed the stored keys — `quoting`,
// `failed` — under a STATUS heading, and again inside the bar's screen-reader
// label.
describe("statusLabel", () => {
  it("says the status the way the desk says it", () => {
    expect(statusLabel("quoting", "en")).toBe("Quoting");
    expect(statusLabel("failed", "en")).toBe("Failed");
  });

  it("translates", () => {
    expect(statusLabel("quoting", "ar")).not.toBe("quoting");
  });

  it("still reads as words for a status nobody wrote a label for", () => {
    expect(statusLabel("pending_settlement", "en")).toBe("Pending settlement");
  });
});
