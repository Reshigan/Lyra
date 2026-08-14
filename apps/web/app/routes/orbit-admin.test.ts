import { describe, expect, it } from "vitest";
import {
  LABELS,
  adminHeadline,
  coverageOf,
  faultsOf,
  labelsIn,
  transportGaps,
  type ConnectorRow,
  type MemberRow,
  type PresenceRow,
  type RuleRow,
  type TeamRow
} from "./orbit-admin";

// The point of this screen is the read across tables: each of these faults is
// invisible in the per-table list the tenant would otherwise be editing.

const team = (over: Partial<TeamRow> = {}): TeamRow => ({
  id: "otm_1",
  key: "care",
  nameJson: { en: "Care", ar: "الرعاية" },
  isDefault: 0,
  status: "active",
  ...over
});

const member = (over: Partial<MemberRow> = {}): MemberRow => ({
  id: "tmm_1",
  teamId: "otm_1",
  userId: "usr_1",
  maxConcurrent: 5,
  ...over
});

const connector = (over: Partial<ConnectorRow> = {}): ConnectorRow => ({
  id: "ccn_1",
  provider: "whatsapp-cloud-api",
  transport: "whatsapp",
  label: "Main line",
  status: "active",
  ...over
});

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: "rr_1",
  seq: 1,
  teamId: "otm_1",
  enabled: 1,
  conditionsJson: {},
  ...over
});

describe("coverageOf", () => {
  it("counts only available people as capacity", () => {
    const presence: PresenceRow[] = [
      { userId: "usr_1", status: "available", activeCount: 2 },
      { userId: "usr_2", status: "away", activeCount: 0 }
    ];
    const [care] = coverageOf(
      [team()],
      [member(), member({ id: "tmm_2", userId: "usr_2", maxConcurrent: 9 })],
      presence
    );
    expect(care).toMatchObject({ members: 2, available: 1, headroom: 3 });
  });

  it("treats a member with no presence row as offline", () => {
    const [care] = coverageOf([team()], [member()], []);
    expect(care).toMatchObject({ members: 1, available: 0, headroom: 0 });
  });

  it("never reports negative headroom when someone is over their limit", () => {
    const [care] = coverageOf([team()], [member({ maxConcurrent: 2 })], [
      { userId: "usr_1", status: "available", activeCount: 7 }
    ]);
    expect(care?.headroom).toBe(0);
  });

  it("reads SQLite's 0/1 boolean as the default flag", () => {
    const [care] = coverageOf([team({ isDefault: 1 })], [], []);
    expect(care?.isDefault).toBe(true);
  });
});

describe("transportGaps", () => {
  it("names every transport no active connector carries", () => {
    expect(transportGaps([connector(), connector({ id: "ccn_2", transport: "email", status: "disabled" })])).toEqual([
      "email",
      "web",
      "voice",
      "agent"
    ]);
  });
});

describe("faultsOf", () => {
  const covered = coverageOf([team()], [member()], [{ userId: "usr_1", status: "available", activeCount: 0 }]);

  it("flags a tenant with no default team", () => {
    const faults = faultsOf({ connectors: [], teams: [team()], rules: [], coverage: covered });
    expect(faults.map((f) => f.key)).toContain("fault.noDefault");
  });

  it("flags more than one default team and names them", () => {
    const teams = [team({ isDefault: 1 }), team({ id: "otm_2", key: "sales", isDefault: true })];
    const faults = faultsOf({ connectors: [], teams, rules: [], coverage: covered });
    expect(faults).toContainEqual({ key: "fault.manyDefaults", ref: "care, sales" });
  });

  it("flags an enabled rule pointing at a team that no longer exists", () => {
    const faults = faultsOf({
      connectors: [],
      teams: [team({ isDefault: 1 })],
      rules: [rule({ seq: 3, teamId: "otm_gone" })],
      coverage: covered
    });
    expect(faults).toContainEqual({ key: "fault.ruleUnknownTeam", ref: "3" });
  });

  it("flags an enabled rule pointing at an empty team", () => {
    const empty = coverageOf([team()], [], []);
    const faults = faultsOf({ connectors: [], teams: [team({ isDefault: 1 })], rules: [rule()], coverage: empty });
    expect(faults).toContainEqual({ key: "fault.ruleEmptyTeam", ref: "1 · care" });
  });

  it("ignores a disabled rule — a rule that never fires strands nothing", () => {
    const empty = coverageOf([team()], [], []);
    const faults = faultsOf({
      connectors: [],
      teams: [team({ isDefault: 1 })],
      rules: [rule({ enabled: 0 })],
      coverage: empty
    });
    expect(faults.map((f) => f.key)).not.toContain("fault.ruleEmptyTeam");
  });

  it("stays quiet when every transport is live and every rule reaches a staffed team", () => {
    const connectors = ["whatsapp", "email", "web", "voice", "agent"].map((transport, index) =>
      connector({ id: `ccn_${index}`, transport })
    );
    const faults = faultsOf({ connectors, teams: [team({ isDefault: 1 })], rules: [rule()], coverage: covered });
    expect(faults).toEqual([]);
  });
});

describe("adminHeadline", () => {
  it("leads with what is stranded over the otherwise-healthy reach numbers", () => {
    const l = labelsIn("en");
    expect(adminHeadline(2, 3, 4, l)).toBe(l("headlineFaults", { n: "2" }));
    expect(adminHeadline(0, 3, 4, l)).toBe(l("headlineOk", { channels: "3", teams: "4" }));
  });
});

describe("ORBIT admin speaks both locales", () => {
  it("has the same keys in en and ar, none left empty or untranslated", () => {
    expect(Object.keys(LABELS.ar ?? {}).sort()).toEqual(Object.keys(LABELS.en ?? {}).sort());
    for (const [key, english] of Object.entries(LABELS.en ?? {})) {
      const arabic = LABELS.ar?.[key] ?? "";
      expect(arabic.trim(), key).not.toBe("");
      expect(arabic, key).not.toBe(english);
    }
  });
});
