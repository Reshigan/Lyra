import { describe, expect, it } from "vitest";
import {
  adminFaults,
  excludedAudienceId,
  guardrailsOf,
  suppressionIds,
  type AudienceRow,
  type CampaignRow
} from "./signal.shared";
import { SIGNAL_POLICIES, autoApprovedIn, disclosureRoll, type DisclosureRow } from "./signal-admin";

// The settings screen is read-only, so what is worth asserting is the reading:
// whether a campaign that is reaching people was ever checked, whether an agent
// that spends has a ceiling, and which audiences are the suppression lists the
// others subtract. Every one of those is a join across two tables that neither
// table's own tab can make.

const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: "cmp_1",
  name: "Spring cover",
  objective: "acquire",
  audienceId: "aud_1",
  channelsJson: ["meta"],
  budgetJson: { currency: "ZAR", dailyMinor: 50_000, autopilotBoundMinor: 10_000 },
  guardrailChecksJson: {
    suppressionAudienceApplied: true,
    frequencyCapPerWeek: 3,
    quietHours: { from: "21:00", to: "07:00", tz: "Africa/Johannesburg" },
    brandKit: "pass",
    bannedClaims: "pass",
    checkedAt: 1_770_000_000_000
  },
  state: "live",
  autonomyLevel: "act_with_approval",
  startAt: null,
  endAt: null,
  ownerRef: null,
  ...over
});

const audience = (over: Partial<AudienceRow> = {}): AudienceRow => ({
  id: "aud_1",
  name: "Lapsed renewals",
  definitionJson: { excludeAudienceId: "aud_supp" },
  sizeCached: 4_200,
  refreshPolicy: "daily",
  consentPurposes: "marketing",
  lastRefreshedAt: 1_770_000_000_000,
  ...over
});

const suppressionList = (over: Partial<AudienceRow> = {}): AudienceRow =>
  audience({ id: "aud_supp", name: "Do not contact", definitionJson: {}, consentPurposes: "none", ...over });

/* ------------------------------------------------------------- derivations */

describe("guardrail reading", () => {
  it("tells never-checked apart from checked-and-clean", () => {
    expect(guardrailsOf(campaign())?.bannedClaims).toBe("pass");
    expect(guardrailsOf(campaign({ guardrailChecksJson: undefined }))).toBeNull();
    expect(guardrailsOf(campaign({ guardrailChecksJson: null }))).toBeNull();
    // A campaign in review has no record yet, and an array is not a record.
    expect(guardrailsOf(campaign({ guardrailChecksJson: [] }))).toBeNull();
  });

  it("reads the column as text too, since only the CRUD layer parses it", () => {
    expect(guardrailsOf(campaign({ guardrailChecksJson: '{"brandKit":"fail"}' }))?.brandKit).toBe("fail");
    expect(guardrailsOf(campaign({ guardrailChecksJson: "not json" }))).toBeNull();
  });
});

describe("suppression sources", () => {
  it("names the list an audience subtracts", () => {
    expect(excludedAudienceId(audience())).toBe("aud_supp");
    expect(excludedAudienceId(audience({ definitionJson: {} }))).toBeNull();
    expect(excludedAudienceId(audience({ definitionJson: { excludeAudienceId: "" } }))).toBeNull();
  });

  it("counts a list as suppression when it has no consent basis or something subtracts it", () => {
    const ids = suppressionIds([audience(), suppressionList()]);
    expect([...ids]).toEqual(["aud_supp"]);
    // Pointed at by another audience is enough, even with a consent basis of its own.
    expect(suppressionIds([audience(), suppressionList({ consentPurposes: "service" })]).has("aud_supp")).toBe(true);
    expect(suppressionIds([]).size).toBe(0);
  });
});

describe("admin faults", () => {
  const clean = { campaigns: [campaign()], audiences: [audience(), suppressionList()] };
  const keys = (input: Parameters<typeof adminFaults>[0]) => adminFaults(input).map((fault) => fault.key);

  it("says nothing is stranded when every check passed", () => {
    expect(adminFaults(clean)).toEqual([]);
  });

  it("flags a campaign reaching people that was never checked", () => {
    expect(keys({ ...clean, campaigns: [campaign({ guardrailChecksJson: null })] })).toContain("admin.fault.unchecked");
    // A draft reaches nobody, so an absent record is not a fault.
    expect(keys({ ...clean, campaigns: [campaign({ state: "review", guardrailChecksJson: null })] })).toEqual([]);
  });

  it("flags a failed claims or brand check, and a suppression list left off", () => {
    expect(
      keys({ ...clean, campaigns: [campaign({ guardrailChecksJson: { bannedClaims: "fail", brandKit: "pass" } })] })
    ).toContain("admin.fault.bannedClaims");
    expect(
      keys({ ...clean, campaigns: [campaign({ guardrailChecksJson: { brandKit: "fail" } })] })
    ).toContain("admin.fault.brandKit");
    expect(
      keys({ ...clean, campaigns: [campaign({ guardrailChecksJson: { suppressionAudienceApplied: false } })] })
    ).toContain("admin.fault.noSuppressionApplied");
  });

  it("flags an agent that may spend alone with no per-move ceiling", () => {
    expect(keys({ ...clean, campaigns: [campaign({ autonomyLevel: "act", budgetJson: { dailyMinor: 50_000 } })] })).toContain(
      "admin.fault.unbounded"
    );
    // Supervised autonomy still asks a person, so a missing ceiling is not a stranding.
    expect(
      keys({ ...clean, campaigns: [campaign({ autonomyLevel: "act_with_approval", budgetJson: {} })] })
    ).toEqual([]);
  });

  it("flags a tenant with audiences but no suppression list at all", () => {
    const faults = keys({ campaigns: [], audiences: [audience({ definitionJson: {} })] });
    expect(faults).toContain("admin.fault.noSuppressionSource");
    expect(faults).toContain("admin.fault.noExclusion");
    // No audience yet is not a fault — there is nothing to hold back from.
    expect(keys({ campaigns: [], audiences: [] })).toEqual([]);
  });

  it("does not ask a suppression list to subtract a suppression list", () => {
    expect(keys({ campaigns: [], audiences: [audience(), suppressionList()] })).toEqual([]);
  });

  it("names the campaign or audience each fault is about", () => {
    const faults = adminFaults({ ...clean, campaigns: [campaign({ name: "Winter push", guardrailChecksJson: null })] });
    expect(faults[0]?.ref).toBe("Winter push");
  });
});

/* --------------------------------------------------------------- this screen */

const disclosure = (over: Partial<DisclosureRow> = {}): DisclosureRow => ({
  key: "advice.scope",
  locale: "en",
  channel: "web",
  ts: 1_770_000_000_000,
  ...over
});

describe("disclosure roll", () => {
  it("counts one row per wording, language and channel, commonest first", () => {
    expect(
      disclosureRoll([
        disclosure(),
        disclosure(),
        disclosure({ locale: "ar" }),
        disclosure({ key: "advice.commission", channel: "whatsapp" })
      ])
    ).toEqual([
      { key: "advice.scope", locale: "en", channel: "web", count: 2 },
      { key: "advice.commission", locale: "en", channel: "whatsapp", count: 1 },
      { key: "advice.scope", locale: "ar", channel: "web", count: 1 }
    ]);
    expect(disclosureRoll([])).toEqual([]);
  });
});

describe("tenant policy", () => {
  it("reads the auto-approve allowlist and ignores anything else in the bag", () => {
    expect(autoApprovedIn({ autoApprove: ["signal.boost", 7, "signal.budget_move"] })).toEqual([
      "signal.boost",
      "signal.budget_move"
    ]);
    expect(autoApprovedIn({})).toEqual([]);
    expect(autoApprovedIn({ autoApprove: "signal.boost" })).toEqual([]);
  });

  it("mirrors every signal policy packages/core registers", () => {
    // If core grows a seventh signal policy, this screen stops listing all of
    // them — the mirror is the price of the web app not importing @lyra/core.
    expect(SIGNAL_POLICIES.map((policy) => policy.key)).toEqual([
      "signal.budget_move",
      "signal.campaign_launch",
      "signal.creative_publish",
      "signal.budget_commit",
      "signal.boost",
      "signal.creator_brief"
    ]);
    expect(SIGNAL_POLICIES.filter((policy) => policy.dualControl !== "never")).toHaveLength(1);
  });
});
