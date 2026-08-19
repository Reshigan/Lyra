import { describe, expect, it } from "vitest";
import type { AttributeCount } from "@lyra/core";
import {
  audienceEvidenceLines,
  audienceProposalMessages,
  audienceProposalSchema,
  fallbackTargetingProposal,
  parseAudienceProposal,
  type AudienceEvidence
} from "./audience-brief.js";
import { promptNouns } from "./vocabulary.js";

// The counting half lives in packages/core/src/targeting.ts; these are what it
// hands over — already suppressed, already stripped of protected axes, most
// common first. Every number a reply is allowed to state comes from here.
const COUNTS: AttributeCount[] = [
  { axis: "region", value: "gauteng", count: 200 },
  { axis: "lsm", value: "7", count: 120 },
  { axis: "ageband", value: "35-44", count: 90 }
];

const EV: AudienceEvidence = {
  subject: "cyber cover",
  momentum: 78,
  signalCount: 220,
  bookSize: 400,
  counts: COUNTS,
  floor: 25
};
const NOUNS = promptNouns(undefined);
const RETAIL = promptNouns("retail-ecom");

const GOOD = {
  name: "Gauteng upper-middle",
  summary: "Upper-middle households in Gauteng who already hold cover with us.",
  selections: [
    { axis: "region", value: "gauteng", reason: "200 customers sit in this region." },
    { axis: "lsm", value: "7", reason: "120 customers carry LSM 7." }
  ]
};

const reply = (over: Partial<typeof GOOD>): string => JSON.stringify({ ...GOOD, ...over });

describe("parseAudienceProposal", () => {
  it("accepts every shown cell and builds the rule tree itself", () => {
    expect(parseAudienceProposal(reply({}), EV, NOUNS)).toEqual({
      name: GOOD.name,
      summary: GOOD.summary,
      demographics: [
        { axis: "region", value: "gauteng" },
        { axis: "lsm", value: "7" }
      ],
      reasons: [
        { axis: "region", value: "gauteng", reason: "200 customers sit in this region.", count: 200 },
        { axis: "lsm", value: "7", reason: "120 customers carry LSM 7.", count: 120 }
      ],
      lsm: [7],
      rule: {
        all: [
          { field: "customer.attr.region", op: "in", value: ["gauteng"] },
          { field: "customer.attr.lsm", op: "in", value: ["7"] },
          { field: "consent.marketing", op: "eq", value: true }
        ]
      },
      // The narrowest axis caps the pool, same arithmetic estimateReach does.
      estimatedReach: 120,
      confidence: 100
    });
  });

  it("gives each axis its own leaf, with the consent leaf always last", () => {
    const parsed = parseAudienceProposal(
      reply({
        selections: [
          { axis: "lsm", value: "7", reason: "120 customers carry LSM 7." },
          { axis: "region", value: "gauteng", reason: "200 customers sit in this region." },
          { axis: "ageband", value: "35-44", reason: "90 customers are 35 to 44." }
        ]
      }),
      EV,
      NOUNS
    );
    expect(parsed?.rule.all).toEqual([
      { field: "customer.attr.lsm", op: "in", value: ["7"] },
      { field: "customer.attr.region", op: "in", value: ["gauteng"] },
      { field: "customer.attr.ageband", op: "in", value: ["35-44"] },
      { field: "consent.marketing", op: "eq", value: true }
    ]);
    expect(parsed?.estimatedReach).toBe(90);
  });

  it("strips a ```json fence", () => {
    expect(parseAudienceProposal("```json\n" + reply({}) + "\n```", EV, NOUNS)?.confidence).toBe(100);
  });

  it("is null for a reply that is not JSON at all", () => {
    expect(parseAudienceProposal("no.", EV, NOUNS)).toBeNull();
  });

  it("is null without a name or a summary", () => {
    expect(parseAudienceProposal(reply({ name: "  " }), EV, NOUNS)).toBeNull();
    expect(parseAudienceProposal(JSON.stringify({ ...GOOD, summary: 7 }), EV, NOUNS)).toBeNull();
  });

  it("is null when selections is empty or not a list — no members is not a smaller audience", () => {
    expect(parseAudienceProposal(reply({ selections: [] }), EV, NOUNS)).toBeNull();
    expect(parseAudienceProposal(JSON.stringify({ ...GOOD, selections: "gauteng" }), EV, NOUNS)).toBeNull();
  });

  it("is null when the summary states a figure the evidence never gave it", () => {
    expect(parseAudienceProposal(reply({ summary: "All 9,412 of them." }), EV, NOUNS)).toBeNull();
  });

  it("drops a protected axis rather than the whole proposal", () => {
    const parsed = parseAudienceProposal(
      reply({
        selections: [
          { axis: "gender", value: "f", reason: "200 of them." },
          ...GOOD.selections
        ]
      }),
      EV,
      NOUNS
    );
    expect(parsed?.demographics).toHaveLength(2);
    expect(parsed?.confidence).toBe(67);
  });

  it("drops an axis nobody may target on, protected or not", () => {
    const parsed = parseAudienceProposal(
      reply({ selections: [{ axis: "income", value: "high", reason: "200 of them." }, ...GOOD.selections] }),
      EV,
      NOUNS
    );
    expect(parsed?.demographics.map((d) => d.axis)).toEqual(["region", "lsm"]);
  });

  it("drops a value that was never on the page — invented or under the floor, same refusal", () => {
    const parsed = parseAudienceProposal(
      reply({ selections: [{ axis: "region", value: "limpopo", reason: "200 of them." }, ...GOOD.selections] }),
      EV,
      NOUNS
    );
    expect(parsed?.demographics.map((d) => d.value)).toEqual(["gauteng", "7"]);
  });

  it("drops an unreasoned selection, and one whose reason cites an unseen number", () => {
    expect(
      parseAudienceProposal(reply({ selections: [{ axis: "region", value: "gauteng", reason: " " }] }), EV, NOUNS)
    ).toBeNull();
    expect(
      parseAudienceProposal(
        reply({ selections: [{ axis: "region", value: "gauteng", reason: "9,412 customers here." }] }),
        EV,
        NOUNS
      )
    ).toBeNull();
  });

  it("drops a repeat of a cell it already accepted", () => {
    const parsed = parseAudienceProposal(
      reply({ selections: [...GOOD.selections, { axis: "region", value: "gauteng", reason: "200, again." }] }),
      EV,
      NOUNS
    );
    expect(parsed?.reasons).toHaveLength(2);
    expect(parsed?.confidence).toBe(67);
  });

  it("skips a selection that is not an object", () => {
    const parsed = parseAudienceProposal(reply({ selections: [null, "gauteng", ...GOOD.selections] as unknown as typeof GOOD.selections }), EV, NOUNS);
    expect(parsed?.reasons).toHaveLength(2);
    expect(parsed?.confidence).toBe(50);
  });

  it("lowercases the axis so LSM and lsm are the same axis", () => {
    const parsed = parseAudienceProposal(
      reply({ selections: [{ axis: "LSM", value: "7", reason: "120 customers carry LSM 7." }] }),
      EV,
      NOUNS
    );
    expect(parsed?.demographics).toEqual([{ axis: "lsm", value: "7" }]);
  });

  it("trims the name and truncates a summary past 300 characters", () => {
    const parsed = parseAudienceProposal(reply({ name: "  Gauteng  ", summary: "x".repeat(400) }), EV, NOUNS);
    expect(parsed?.name).toBe("Gauteng");
    expect(parsed?.summary).toHaveLength(300);
  });

  it("is null when every selection was thrown away", () => {
    expect(
      parseAudienceProposal(reply({ selections: [{ axis: "race", value: "x", reason: "200 of them." }] }), EV, NOUNS)
    ).toBeNull();
  });

  it("reports no LSM band for a pool cut on other axes", () => {
    const parsed = parseAudienceProposal(reply({ selections: [GOOD.selections[0]!] }), EV, NOUNS);
    expect(parsed?.lsm).toEqual([]);
  });

  it("sorts LSM bands ascending whatever order they were proposed in", () => {
    const counts: AttributeCount[] = [
      { axis: "lsm", value: "9", count: 40 },
      { axis: "lsm", value: "7", count: 120 }
    ];
    const ev = { ...EV, counts };
    const parsed = parseAudienceProposal(
      JSON.stringify({
        name: "Top bands",
        summary: "The two wealthiest bands on the book.",
        selections: [
          { axis: "lsm", value: "9", reason: "40 customers here." },
          { axis: "lsm", value: "7", reason: "120 customers here." }
        ]
      }),
      ev,
      NOUNS
    );
    expect(parsed?.lsm).toEqual([7, 9]);
    // Alternatives on one axis add rather than intersect.
    expect(parsed?.estimatedReach).toBe(160);
  });
});

describe("audienceEvidenceLines", () => {
  it("states the book, the floor and every suppressed cell", () => {
    expect(audienceEvidenceLines(EV, NOUNS)).toEqual([
      "Campaign subject: cyber cover",
      "Demand momentum score (0-100): 78",
      "Demand signals behind this subject: 220",
      "Customers in the book: 400",
      "Active policies are sold to these customers; counts below are per attribute, not per policy.",
      "Counts below are suppressed under a k-anonymity floor of 25; nothing thinner is shown.",
      "Attribute region=gauteng: 200 customers",
      "Attribute lsm=7: 120 customers. LSM 7 — upper middle, multiple durables",
      "Attribute ageband=35-44: 90 customers"
    ]);
  });

  it("omits momentum and signal count entirely for a scenario, rather than saying zero", () => {
    const lines = audienceEvidenceLines({ ...EV, momentum: null, signalCount: null }, NOUNS);
    expect(lines.join("\n")).not.toContain("momentum");
    expect(lines.join("\n")).not.toContain("Demand signals");
    expect(lines[1]).toBe("Customers in the book: 400");
  });

  it("keeps a measured zero", () => {
    expect(audienceEvidenceLines({ ...EV, momentum: 0 }, NOUNS)[1]).toBe("Demand momentum score (0-100): 0");
  });

  it("labels an LSM band so the model reads a lifestyle, not a bare digit", () => {
    expect(audienceEvidenceLines(EV, NOUNS)[7]).toContain("upper middle, multiple durables");
  });

  it("leaves a non-LSM cell unlabelled", () => {
    expect(audienceEvidenceLines(EV, NOUNS)[6]).toBe("Attribute region=gauteng: 200 customers");
  });

  it("reads the contract noun off the domain pack", () => {
    expect(audienceEvidenceLines(EV, RETAIL)[4]).toBe(
      "Active orders are sold to these customers; counts below are per attribute, not per order."
    );
  });
});

describe("audienceProposalSchema", () => {
  it("asks for selections, never for a rule tree", () => {
    expect(audienceProposalSchema()).toEqual({
      name: "signal_targeting_proposal",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          summary: { type: "string" },
          selections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                axis: { type: "string" },
                value: { type: "string" },
                reason: { type: "string" }
              },
              required: ["axis", "value", "reason"]
            }
          }
        },
        required: ["name", "summary", "selections"]
      }
    });
  });
});

describe("audienceProposalMessages", () => {
  const messages = audienceProposalMessages(EV, NOUNS);

  it("sends one system prompt then the evidence as the user turn", () => {
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content).toBe(audienceEvidenceLines(EV, NOUNS).join("\n"));
  });

  it("forbids unevidenced numbers, invented bands and a widened value", () => {
    const system = messages[0]?.content ?? "";
    expect(system).toContain("State no number the evidence below did not give you");
    expect(system).toContain("do not invent a band, and do not widen a value");
    expect(system).toContain("you never see a");
  });

  it("names every protected ground so the model is told, not merely filtered", () => {
    const system = messages[0]?.content ?? "";
    for (const ground of ["race", "religion", "health", "disability", "biometrics", "criminal record"]) {
      expect(system).toContain(ground);
    }
  });

  it("explains the arithmetic, so alternation is not read as intersection", () => {
    expect(messages[0]?.content).toContain("Values on the same axis are alternatives");
    expect(messages[0]?.content).toContain("the smallest axis caps the reach");
  });

  it("says an unreasoned selection is discarded", () => {
    expect(messages[0]?.content).toContain("A selection without a reason is discarded");
  });

  it("names the pack's domain, not a hard-coded industry", () => {
    const system = audienceProposalMessages(EV, RETAIL)[0]?.content ?? "";
    expect(system).toContain("retail commerce");
    expect(system).not.toContain("insurance");
  });
});

describe("fallbackTargetingProposal", () => {
  it("takes the largest cell on each of the two largest axes", () => {
    const proposal = fallbackTargetingProposal(EV, NOUNS);
    expect(proposal.demographics).toEqual([
      { axis: "region", value: "gauteng" },
      { axis: "lsm", value: "7" }
    ]);
    expect(proposal.estimatedReach).toBe(120);
  });

  it("carries zero confidence, so a reader can tell no model chose it", () => {
    expect(fallbackTargetingProposal(EV, NOUNS).confidence).toBe(0);
  });

  it("is grounded in the evidence by construction", () => {
    const proposal = fallbackTargetingProposal(EV, NOUNS);
    expect(parseAudienceProposal(JSON.stringify({ ...proposal, selections: proposal.reasons }), EV, NOUNS)).toMatchObject(
      { demographics: proposal.demographics }
    );
  });

  it("states the count as its own reason", () => {
    expect(fallbackTargetingProposal(EV, NOUNS).reasons[0]?.reason).toBe(
      "200 customers carry region=gauteng, the largest cell on this attribute."
    );
  });

  it("takes one cell per axis, never two off the same one", () => {
    const counts: AttributeCount[] = [
      { axis: "region", value: "gauteng", count: 200 },
      { axis: "region", value: "wc", count: 150 },
      { axis: "lsm", value: "7", count: 120 }
    ];
    expect(fallbackTargetingProposal({ ...EV, counts }, NOUNS).demographics.map((d) => d.axis)).toEqual([
      "region",
      "lsm"
    ]);
  });

  it("skips an untargetable axis even here", () => {
    const counts: AttributeCount[] = [
      { axis: "gender", value: "f", count: 300 },
      { axis: "region", value: "gauteng", count: 200 }
    ];
    expect(fallbackTargetingProposal({ ...EV, counts }, NOUNS).demographics).toEqual([
      { axis: "region", value: "gauteng" }
    ]);
  });

  it("proposes nothing at all for a book with no targetable attribute", () => {
    const proposal = fallbackTargetingProposal({ ...EV, counts: [] }, NOUNS);
    expect(proposal.demographics).toEqual([]);
    expect(proposal.estimatedReach).toBe(0);
    // The consent leaf survives an empty pool: it is not the model's to omit.
    expect(proposal.rule.all).toEqual([{ field: "consent.marketing", op: "eq", value: true }]);
  });

  it("names the subject and tells the reader to narrow it before spending", () => {
    const proposal = fallbackTargetingProposal(EV, NOUNS);
    expect(proposal.name).toBe("cyber cover — largest reachable segments");
    expect(proposal.summary).toContain("narrow it before committing policy spend");
  });

  it("reads the contract noun off the domain pack", () => {
    expect(fallbackTargetingProposal(EV, RETAIL).summary).toContain("order spend");
  });
});
