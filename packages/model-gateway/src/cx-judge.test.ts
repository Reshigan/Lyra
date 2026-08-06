import { describe, expect, it } from "vitest";
import {
  CX_JUDGE_SAMPLES,
  CX_JUDGE_VERSION,
  CX_RUBRIC,
  aggregateCxScore,
  cxJudgePrompt,
  localeGap,
  parseCxScore
} from "./cx-judge.js";

const reply = (scores: Record<string, number>): string => JSON.stringify(scores);

const good = reply({ accuracy: 5, clarity: 4, tone: 5, actionability: 4 });

describe("cxJudgePrompt", () => {
  const sample = {
    locale: "ar" as const,
    context: ["Customer: كم قسط التأمين؟", "Agent: 2,400 درهم سنويًا."],
    reply: "قسطك السنوي 2,400 درهم. أستطيع إصدار الوثيقة الآن إن رغبت."
  };

  it("names every rubric dimension so the judge cannot invent its own", () => {
    const prompt = cxJudgePrompt(sample);
    for (const dimension of CX_RUBRIC) expect(prompt).toContain(dimension.name);
  });

  it("tells the judge to score arabic as arabic, not as translated english", () => {
    expect(cxJudgePrompt(sample)).toContain("ar");
    expect(cxJudgePrompt({ ...sample, locale: "en" })).toContain("en");
  });

  it("carries the conversation and the reply under evaluation", () => {
    const prompt = cxJudgePrompt(sample);
    expect(prompt).toContain("كم قسط التأمين؟");
    expect(prompt).toContain(sample.reply);
  });

  it("is frozen: the version travels with the prompt", () => {
    expect(cxJudgePrompt(sample)).toContain(CX_JUDGE_VERSION);
  });
});

describe("parseCxScore", () => {
  it("averages the rubric dimensions", () => {
    expect(parseCxScore(good)).toBeCloseTo(4.5, 5);
  });

  it("reads a reply the judge wrapped in a code fence", () => {
    expect(parseCxScore("```json\n" + good + "\n```")).toBeCloseTo(4.5, 5);
  });

  it("ignores a rationale the judge added beside the scores", () => {
    expect(parseCxScore(reply({ accuracy: 4, clarity: 4, tone: 4, actionability: 4 } as never))).toBe(4);
    const withWhy = JSON.stringify({ accuracy: 4, clarity: 4, tone: 4, actionability: 4, why: "grounded, warm" });
    expect(parseCxScore(withWhy)).toBe(4);
  });

  it("is null when a dimension is missing rather than scoring the rest", () => {
    expect(parseCxScore(reply({ accuracy: 5, clarity: 5, tone: 5 }))).toBeNull();
  });

  it("is null on a reply that is not JSON at all", () => {
    expect(parseCxScore("I would rate this a solid four out of five.")).toBeNull();
  });

  it("rejects a score outside the 1-5 rubric rather than clamping it", () => {
    expect(parseCxScore(reply({ accuracy: 9, clarity: 5, tone: 5, actionability: 5 }))).toBeNull();
    expect(parseCxScore(reply({ accuracy: 0, clarity: 5, tone: 5, actionability: 5 }))).toBeNull();
  });
});

describe("aggregateCxScore", () => {
  it("takes the median of the samples, so one erratic judge run cannot carry the score", () => {
    const scores = [4, 4, 4, 4, 1].map((n) =>
      reply({ accuracy: n, clarity: n, tone: n, actionability: n })
    );
    expect(aggregateCxScore(scores)).toBe(4);
  });

  it("averages the middle pair when the sample count is even", () => {
    const scores = [3, 4].map((n) => reply({ accuracy: n, clarity: n, tone: n, actionability: n }));
    expect(aggregateCxScore(scores)).toBe(3.5);
  });

  it("drops unparseable judge runs instead of scoring them zero", () => {
    const scores = ["refused to answer", good, good];
    expect(aggregateCxScore(scores)).toBeCloseTo(4.5, 5);
  });

  it("is null when no run parsed — an unscored sample is not a bad sample", () => {
    expect(aggregateCxScore(["", "nope"])).toBeNull();
    expect(aggregateCxScore([])).toBeNull();
  });

  it("samples five times per docs/13 §3.4", () => {
    expect(CX_JUDGE_SAMPLES).toBe(5);
  });
});

describe("localeGap", () => {
  it("is the absolute distance, so neither language is the privileged baseline", () => {
    expect(localeGap(4.4, 4.2)).toBeCloseTo(0.2, 5);
    expect(localeGap(4.2, 4.4)).toBeCloseTo(0.2, 5);
  });

  it("is zero for parity", () => {
    expect(localeGap(4.3, 4.3)).toBe(0);
  });
});
