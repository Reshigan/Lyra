import { describe, expect, it } from "vitest";
import {
  adminHeadline,
  aeoHeadline,
  audValueHeadline,
  briefFromOpportunity,
  budgetHeadline,
  citationsOf,
  cockpitHeadline,
  devHeadline,
  engineName,
  expHeadline,
  growthHeadline,
  labelsIn,
  mainCurrency,
  moveEndpoint,
  splitCopy,
  studioHeadline,
  totalSpendMinor
} from "./signal.shared";
import type { AeoRow, AudienceValue, CampaignRow, SpendRow } from "./signal.shared";

// The budget screen's "Moves made" table printed
// `signal_campaign:cmp_0KE95STOARG4GC1CVMRRB6Q4R#meta →
//  signal_campaign:cmp_0KE95STOARG4GC1CVMRRB6Q4R#google_search`
// on every row — the machine's spelling of "Facebook to Google Search".
describe("moveEndpoint", () => {
  const names = { cmp_01KE9: "Renewal save" };

  it("reads as the campaign and the channel inside it", () => {
    expect(moveEndpoint("signal_campaign:cmp_01KE9#meta", names)).toBe("Renewal save · Facebook");
  });

  it("falls back to the channel when the campaign was not loaded", () => {
    expect(moveEndpoint("signal_campaign:cmp_gone#google_search", names)).toBe("Google Search");
  });

  it("names the campaign when the move was not channel-specific", () => {
    expect(moveEndpoint("signal_campaign:cmp_01KE9", names)).toBe("Renewal save");
  });

  it("shows what it was given when it recognises neither", () => {
    expect(moveEndpoint("something_else", names)).toBe("something_else");
  });
});

// The budget screen headed "ZAR 60,000.00" over a table of AED campaigns: the
// first campaign's currency labelling a sum of every campaign's minor units.
const campaign = (currency: string): CampaignRow =>
  ({ budgetJson: { currency, dailyMinor: 50_000 } }) as unknown as CampaignRow;

describe("mainCurrency", () => {
  it("is the one most campaigns are budgeted in", () => {
    expect(mainCurrency([campaign("AED"), campaign("AED"), campaign("ZAR")])).toBe("AED");
  });

  it("falls back when no campaign says", () => {
    expect(mainCurrency([], "AED")).toBe("AED");
  });
});

describe("totalSpendMinor", () => {
  const rows = [
    { amountMinor: 100, currency: "AED" },
    { amountMinor: 250, currency: "ZAR" }
  ] as SpendRow[];

  it("adds only what is in the currency asked for", () => {
    expect(totalSpendMinor(rows, "AED")).toBe(100);
  });

  it("adds everything when no currency is named", () => {
    expect(totalSpendMinor(rows)).toBe(350);
  });
});

// The answer-engines table printed "[object Object]" under QUOTED BY: the
// crawler writes sightings, not names.
const page = (citedByJson: string | null): AeoRow => ({ citedByJson }) as AeoRow;

describe("citationsOf", () => {
  it("names the engine inside a sighting record", () => {
    expect(
      citationsOf(page(JSON.stringify([{ engine: "chatgpt", firstSeen: 1 }, { engine: "perplexity" }])))
    ).toEqual(["ChatGPT", "Perplexity"]);
  });

  it("still reads a bare list of names", () => {
    expect(citationsOf(page(JSON.stringify(["gemini"])))).toEqual(["Gemini"]);
  });

  it("still reads the wrapped shape", () => {
    expect(citationsOf(page(JSON.stringify({ engines: ["chatgpt"] })))).toEqual(["ChatGPT"]);
  });

  it("is empty when nothing quoted the page", () => {
    expect(citationsOf(page(null))).toEqual([]);
    expect(citationsOf(page(JSON.stringify([{ lastSeen: 3 }])))).toEqual([]);
  });
});

describe("engineName", () => {
  it("titles an engine nobody spelled for it", () => {
    expect(engineName("some_new_engine")).toBe("Some New Engine");
  });
});

// A variant is one line of prose, and the post card needs a headline and a
// supporting line — this is the only split available without asking the model
// for structure it was never told to produce.
describe("splitCopy", () => {
  it("takes the first sentence as the headline", () => {
    expect(splitCopy("Cover the gap. Renew before the 30th and keep your no-claim year.")).toEqual({
      headline: "Cover the gap.",
      body: "Renew before the 30th and keep your no-claim year."
    });
  });

  it("breaks Arabic on its own punctuation", () => {
    const { headline, body } = splitCopy("هل فاتك التجديد؟ جدّد اليوم واحتفظ بخصمك.");
    expect(headline).toBe("هل فاتك التجديد؟");
    expect(body).toBe("جدّد اليوم واحتفظ بخصمك.");
  });

  it("keeps a one-sentence variant whole", () => {
    expect(splitCopy("  Renew today.  ")).toEqual({ headline: "Renew today.", body: "" });
  });
});

// The cockpit's headline picks one of four answers, ranked by what an
// operator wants first: a move the autopilot made outranks plan risk,
// which outranks mere activity, which outranks quiet.
describe("cockpitHeadline", () => {
  const l = labelsIn("en");

  it("leads with an autopilot move", () => {
    expect(cockpitHeadline(l, { movesCount: 2, planPct: 150, runningCount: 5 })).toBe(
      l("cockpit.answer.moved", { n: "2" })
    );
  });

  it("falls back to plan overrun when nothing moved", () => {
    expect(cockpitHeadline(l, { movesCount: 0, planPct: 120, runningCount: 5 })).toBe(
      l("cockpit.answer.overPlan", { n: "120" })
    );
  });

  it("falls back to running campaigns when on or under plan", () => {
    expect(cockpitHeadline(l, { movesCount: 0, planPct: 80, runningCount: 3 })).toBe(
      l("cockpit.answer.running", { n: "3" })
    );
  });

  it("reads quiet when nothing moved, over-ran or ran", () => {
    expect(cockpitHeadline(l, { movesCount: 0, planPct: 0, runningCount: 0 })).toBe(l("cockpit.answer.quiet"));
  });
});

describe("briefFromOpportunity", () => {
  const l = labelsIn("en");

  it("carries the finding and its numbers into the brief", () => {
    const brief = briefFromOpportunity(
      {
        id: "wsp_1",
        description: "Gig drivers have no day-rate cover",
        category: "motor",
        demandEstimate: 4200,
        competitionScore: 18
      },
      l
    );
    expect(brief).toContain("Gig drivers have no day-rate cover");
    expect(brief).toContain("motor");
    expect(brief).toContain("4200");
    expect(brief).toContain("18/100");
  });

  // A whitespace is allowed to be a sentence and nothing else; the brief must
  // not open with a trailing separator.
  it("drops the facts line when the row carries none", () => {
    expect(briefFromOpportunity({ id: "wsp_2", description: "Only words" }, l)).toBe("Only words");
  });

  it("keeps a zero score rather than reading it as missing", () => {
    expect(briefFromOpportunity({ id: "wsp_3", description: "d", competitionScore: 0 }, l)).toContain("0/100");
  });
});

// The retrofit gave every other SIGNAL screen the same kind of hero the
// cockpit already had — a headline computed from what the loader actually
// found, ranked by what an operator needs to see first.
describe("studioHeadline", () => {
  const l = labelsIn("en");
  const campaign = { name: "Renewal save" } as unknown as CampaignRow;

  it("names the campaign and the step it's on", () => {
    expect(studioHeadline(l, campaign, 3)).toBe(`Renewal save · ${l("studio.step3")}`);
  });

  it("falls back to the screen title before a campaign is chosen", () => {
    expect(studioHeadline(l, null, 1)).toBe(l("studio.title"));
  });
});

describe("audValueHeadline", () => {
  const l = labelsIn("en");
  const best = { audience: { name: "High-intent renewals" }, multiple: 3.2 } as unknown as AudienceValue;

  it("leads with a losing audience over a leader", () => {
    expect(audValueHeadline(l, "en", { best, losing: 2 })).toBe(l("aud.answer.losing", { n: "2" }));
  });

  it("falls back to the best-performing audience", () => {
    expect(audValueHeadline(l, "en", { best, losing: 0 })).toBe(
      l("aud.answer.best", { name: "High-intent renewals", multiple: "3.2×" })
    );
  });

  it("reads as unmeasured when nothing has enough signings yet", () => {
    expect(audValueHeadline(l, "en", { best: null, losing: 0 })).toBe(l("aud.answer.none"));
  });
});

describe("aeoHeadline", () => {
  const l = labelsIn("en");

  it("leads with stale pages over citation share", () => {
    expect(aeoHeadline(l, { staleCount: 4, published: 10, citationSharePct: 50 })).toBe(
      l("aeo.staleWarning", { n: "4" })
    );
  });

  it("falls back to citation share when nothing is stale", () => {
    expect(aeoHeadline(l, { staleCount: 0, published: 10, citationSharePct: 62 })).toBe(
      l("aeo.answer.share", { pct: "62" })
    );
  });

  it("reads as empty before anything is published", () => {
    expect(aeoHeadline(l, { staleCount: 0, published: 0, citationSharePct: 0 })).toBe(l("aeo.answer.none"));
  });
});

describe("expHeadline", () => {
  const l = labelsIn("en");

  it("leads with a decided winner over one still running", () => {
    expect(expHeadline(l, { won: 2, running: 5 })).toBe(l("exp.answer.won", { n: "2" }));
  });

  it("falls back to what's running when nothing has won yet", () => {
    expect(expHeadline(l, { won: 0, running: 3 })).toBe(l("exp.answer.running", { n: "3" }));
  });

  it("reads as empty when nothing is running or won", () => {
    expect(expHeadline(l, { won: 0, running: 0 })).toBe(l("exp.none"));
  });
});

describe("budgetHeadline", () => {
  const l = labelsIn("en");
  const money = (n: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

  it("reads as overspend when headroom is negative", () => {
    expect(budgetHeadline(l, "en", { headroomMinor: -150_000, currency: "ZAR" })).toBe(
      l("budget.answer.over", { amount: money(1500) })
    );
  });

  it("reads as headroom when spend is under plan", () => {
    expect(budgetHeadline(l, "en", { headroomMinor: 250_000, currency: "ZAR" })).toBe(
      l("budget.answer.under", { amount: money(2500) })
    );
  });
});

describe("growthHeadline", () => {
  const l = labelsIn("en");

  it("reads the LTV:CAC multiple when one exists", () => {
    expect(growthHeadline(l, "en", 2.5)).toBe(l("growth.answer.ratio", { multiple: "2.5×" }));
  });

  it("reads as unpriced when there aren't enough binds yet", () => {
    expect(growthHeadline(l, "en", null)).toBe(l("growth.answer.none"));
  });
});

describe("adminHeadline", () => {
  const l = labelsIn("en");

  it("counts what needs attention", () => {
    expect(adminHeadline(l, 3)).toBe(l("admin.answer.faults", { n: "3" }));
  });

  it("reuses the empty state's own title when nothing is stranded", () => {
    expect(adminHeadline(l, 0)).toBe(l("admin.readyTitle"));
  });
});

describe("devHeadline", () => {
  const l = labelsIn("en");

  it("counts readable resources and listening webhooks", () => {
    expect(devHeadline(l, { readable: 4, hooks: 2 })).toBe(l("dev.answer.ready", { n: "4", hooks: "2" }));
  });

  it("reads as denied when the role can read nothing", () => {
    expect(devHeadline(l, { readable: 0, hooks: 0 })).toBe(l("dev.denied"));
  });
});
