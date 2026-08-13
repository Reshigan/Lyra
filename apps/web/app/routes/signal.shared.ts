import { vocabulary } from "../modules/vocabulary";
import { pseudoText } from "../i18n";

// The bespoke SIGNAL screens share one labeller and one set of
// derivations, for the same reason ledger.shared.ts exists: the cockpit, the
// studio, the budget bounds, the growth numbers, the audience value view, the
// experiments and the answer-engine coverage all read the same four ledgers
// (spend, attribution, campaigns, budget moves) and would otherwise each grow
// their own copy of CAC.
//
// Labels are local rather than app/i18n: those catalogues are shared across
// agents and these words belong to these screens. Keys are namespaced by screen
// (`cockpit.*`, `studio.*`, `budget.*`, `growth.*`, `aud.*`, `aeo.*`, `exp.*`);
// the unnamespaced ones are shared by all seven.
//
// The API has no CAC/LTV endpoint — the autopilot computes both internally
// (apps/api/src/engines/signal-autopilot.ts) and exposes neither — so the
// helpers below derive them from the spend ledger and the attribution touches.

/* ------------------------------------------------------------- permissions */

/** The exact strings the SIGNAL handlers call require_() with. */
export const PERM = {
  campaignsRead: "signal:campaigns:read",
  campaignsCreate: "signal:campaigns:create",
  campaignsUpdate: "signal:campaigns:update",
  creativesRead: "signal:creatives:read",
  creativesGenerate: "signal:creatives:generate",
  creativesApprove: "signal:creatives:approve",
  audiencesRead: "signal:audiences:read",
  experimentsRead: "signal:experiments:read",
  experimentsCreate: "signal:experiments:create",
  experimentsDecide: "signal:experiments:decide",
  movesRead: "signal:budget_moves:read",
  movesApprove: "signal:budget_moves:approve",
  aeoRead: "signal:aeo:read",
  aeoWrite: "signal:aeo:write",
  attributionRead: "signal:attribution:read",
  spendRead: "signal:spend:read",
  autopilotPause: "signal:autopilot:pause",
  autopilotRun: "signal:autopilot:run",
  exportCreate: "analytics:exports:create"
} as const;

/* ------------------------------------------------------------------- shapes */

/** apps/api/src/crud.ts list envelope. */
export interface Page<T> {
  data: T[];
  cursor?: string;
  total?: number;
}

export interface SpendRow {
  id: string;
  campaignId: string | null;
  channel: string;
  /** `YYYY-MM-DD` — the identity of the row, not a timestamp. */
  day: string;
  amountMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  source: string;
  ts: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  objective: string;
  audienceId: string | null;
  /** crud.ts hydrate() returns `*Json` columns parsed, so these arrive as
   *  objects — except when the stored text was unparseable, hence `unknown`. */
  channelsJson: unknown;
  budgetJson: unknown;
  /** Absent until the compliance pass has run over the campaign at least once. */
  guardrailChecksJson?: unknown;
  state: string;
  autonomyLevel: string;
  startAt: number | null;
  endAt: number | null;
  ownerRef: string | null;
}

export interface CreativeRow {
  id: string;
  campaignId: string | null;
  kind: string;
  locale: string;
  contentRef: string;
  variantGroup: string | null;
  complianceStatus: string;
  complianceNotesJson: unknown;
  performanceJson: unknown;
  generatedBy: string;
  aiAuditId: string | null;
  createdAt: number;
}

export interface MoveRow {
  id: string;
  fromRef: string;
  toRef: string;
  amountMinor: number;
  currency: string;
  reason: string;
  evidenceJson: unknown;
  approvedBy: string | null;
  reversedBy: string | null;
  reversedAt: number | null;
  reversibleUntil: number | null;
  ts: number;
}

export interface TouchRow {
  id: string;
  customerId: string | null;
  anonId: string | null;
  touchType: string;
  channel: string;
  campaignId: string | null;
  creativeId: string | null;
  valueMinor: number | null;
  currency: string | null;
  subjectRef: string | null;
  ts: number;
}

export interface AudienceRow {
  id: string;
  name: string;
  definitionJson: unknown;
  sizeCached: number | null;
  refreshPolicy: string;
  consentPurposes: string | null;
  lastRefreshedAt: number | null;
}

export interface AeoRow {
  id: string;
  queryCluster: string;
  locale: string;
  contentRef: string;
  citationsCheckJson: unknown;
  freshness: number | null;
  citedByJson: unknown;
  status: string;
  updatedAt: number;
}

export interface ExperimentRow {
  id: string;
  campaignId: string | null;
  hypothesis: string;
  variantsJson: unknown;
  metric: string;
  minSample: number | null;
  /** draft | running | concluded | abandoned (packages/db/src/schema/signal.ts). */
  state: string;
  resultJson: unknown;
  concludedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One arm of a test. `splitBps` is its share of traffic, 10 000 = all of it. */
export interface Variant {
  key: string;
  label?: string;
  creativeId?: string;
  splitBps?: number;
}

/**
 * What was written when the test stopped. Two shapes live in this column: a
 * measured stop carries samples and rates, an abandoned one carries the reason
 * it never got there. Every field is optional because both are the same column.
 */
export interface ExperimentResult {
  verdict?: string;
  winner?: string | null;
  samples?: Record<string, number>;
  rateBps?: Record<string, number>;
  upliftBps?: number;
  probabilityToBeatControlBps?: number;
  stoppedBy?: string;
  note?: string;
  /** Abandoned tests only. */
  reason?: string;
  reachableShareBps?: number;
  abandonedBy?: string;
}

/** The campaign's `budgetJson`, as the autopilot reads it. */
export interface Budget {
  dailyMinor?: number;
  capMinor?: number;
  totalMinor?: number;
  currency?: string;
  /** The most the autopilot may move in one decision without asking. */
  autopilotBoundMinor?: number;
}

/** What a screen renders when the outcome was a refusal it can explain. */
export interface Problemish {
  title: string;
  status: number;
  code?: string;
  detail?: string;
  policy_key?: string;
}

/* ------------------------------------------------------------------ plumbing */

/**
 * A read whose permission the actor may not hold. One withheld tab must not
 * blank a cockpit that has five others to show, so a 403/404 reads as absence.
 */
export async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

/** Per-load key so a double submit is one write (docs/19 §idempotency). */
export function mintKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/**
 * A `*Json` column as the API hands it over: already parsed by crud.ts
 * hydrate(), or still a string when the stored text would not parse. Both are
 * read here so one bad row cannot throw a whole screen.
 */
export function asJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** The campaign's budget, whatever shape the column came back in. */
export function budgetOf(campaign: CampaignRow): Budget {
  return asJson<Budget>(campaign.budgetJson, {});
}

/**
 * The places a campaign can run. Slugs are what the API and the seed store
 * (`google_search`, `meta`); the label is what a person reads. Unknown slugs
 * are still rendered — an importer may know a channel this list does not —
 * so this is a display catalogue, not a validation whitelist.
 *
 * ponytail: two locales inline. Move to the domain pack when a tenant sells
 * through a channel that needs its own naming.
 */
export const SIGNAL_CHANNELS: ReadonlyArray<{ slug: string; en: string; ar: string }> = [
  { slug: "google_search", en: "Google Search", ar: "بحث Google" },
  { slug: "bing_search", en: "Bing Search", ar: "بحث Bing" },
  { slug: "meta", en: "Facebook", ar: "فيسبوك" },
  { slug: "instagram", en: "Instagram", ar: "إنستغرام" },
  { slug: "youtube", en: "YouTube", ar: "يوتيوب" },
  { slug: "email", en: "Email", ar: "البريد الإلكتروني" },
  { slug: "whatsapp", en: "WhatsApp", ar: "واتساب" },
  { slug: "sms", en: "SMS", ar: "رسالة نصية" },
  { slug: "push", en: "Push", ar: "إشعار" }
];

/** `quote_start_rate` → "Quote Start Rate". A slug nobody named is still words. */
export function humanise(slug: string): string {
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A channel slug as a person reads it — `google_search` → "Google Search". */
export function channelLabel(slug: string, locale = "en"): string {
  const known = SIGNAL_CHANNELS.find((channel) => channel.slug === slug);
  if (known) return locale.startsWith("ar") ? known.ar : known.en;
  return humanise(slug);
}

/**
 * Where a budget move came from or went to. The autopilot stores an endpoint as
 * `signal_campaign:cmp_01KE…#google_search` — the campaign, then the channel
 * inside it — and the moves table printed exactly that on both sides of the
 * arrow, twice per row. `names` is campaign id → campaign name; a campaign the
 * caller did not load falls back to the channel alone, which is still a place a
 * person recognises.
 */
export function moveEndpoint(ref: string, names: Record<string, string>, locale = "en"): string {
  const [target = "", channel] = ref.split("#");
  const id = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
  const campaign = names[id];
  const place = channel ? channelLabel(channel, locale) : "";
  if (campaign && place) return `${campaign} · ${place}`;
  return campaign || place || ref;
}

export function channelsOf(campaign: CampaignRow): string[] {
  const raw = asJson<unknown>(campaign.channelsJson, []);
  if (Array.isArray(raw)) return raw.map((entry) => String(entry)).filter(Boolean);
  // Written by some importers as `{ channels: [...] }`.
  const nested = (raw as { channels?: unknown }).channels;
  return Array.isArray(nested) ? nested.map((entry) => String(entry)).filter(Boolean) : [];
}

/* ------------------------------------------------------------- derivations */

export interface ChannelRoll {
  channel: string;
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Attribution touches of type `bind` — the acquisition the spend bought. */
  binds: number;
  valueMinor: number;
}

const BIND = "bind";

export function totalSpendMinor(rows: readonly SpendRow[], currency?: string): number {
  return rows
    .filter((row) => !currency || row.currency === currency)
    .reduce((sum, row) => sum + (row.amountMinor || 0), 0);
}

/**
 * The currency a screen totals in: the one most of its campaigns are budgeted
 * in. Minor units from two currencies added together make a number that is true
 * in neither — the budget screen headed a ZAR 60,000 ceiling over a table of
 * AED campaigns — so every total here is scoped to this one and each row keeps
 * its own.
 */
export function mainCurrency(campaigns: readonly CampaignRow[], fallback = "ZAR"): string {
  const tally = new Map<string, number>();
  for (const campaign of campaigns) {
    const code = budgetOf(campaign).currency;
    if (code) tally.set(code, (tally.get(code) ?? 0) + 1);
  }
  let best = fallback;
  let seen = 0;
  for (const [code, count] of tally) {
    if (count > seen) {
      best = code;
      seen = count;
    }
  }
  return best;
}

/** Spend and outcome side by side per channel. The join is the channel string:
 *  both ledgers are written by the same importers against the same names. */
export function rollByChannel(
  spend: readonly SpendRow[],
  touches: readonly TouchRow[]
): ChannelRoll[] {
  const rolls = new Map<string, ChannelRoll>();
  const at = (channel: string): ChannelRoll => {
    let roll = rolls.get(channel);
    if (!roll) {
      roll = { channel, spendMinor: 0, impressions: 0, clicks: 0, conversions: 0, binds: 0, valueMinor: 0 };
      rolls.set(channel, roll);
    }
    return roll;
  };
  for (const row of spend) {
    const roll = at(row.channel);
    roll.spendMinor += row.amountMinor || 0;
    roll.impressions += row.impressions || 0;
    roll.clicks += row.clicks || 0;
    roll.conversions += row.conversions || 0;
  }
  for (const touch of touches) {
    if (touch.touchType !== BIND) continue;
    const roll = at(touch.channel);
    roll.binds += 1;
    roll.valueMinor += touch.valueMinor || 0;
  }
  return [...rolls.values()].sort((a, b) => b.spendMinor - a.spendMinor);
}

/** Spend per acquisition. `null` when nothing converted: a CAC of infinity is
 *  a number the screen would render as money, and zero is a lie. */
export function cacMinor(spendMinor: number, binds: number): number | null {
  return binds > 0 ? Math.round(spendMinor / binds) : null;
}

/** Mean value of a bind. The ledger's `valueMinor` is the contract value, which
 *  is the only lifetime signal SIGNAL has without reaching into AXIS. */
export function ltvMinor(touches: readonly TouchRow[]): number | null {
  const binds = touches.filter((touch) => touch.touchType === BIND);
  if (binds.length === 0) return null;
  return Math.round(binds.reduce((sum, touch) => sum + (touch.valueMinor || 0), 0) / binds.length);
}

/** LTV:CAC as a plain multiple. Below 1 the channel loses money per customer. */
export function ltvToCac(ltv: number | null, cac: number | null): number | null {
  if (ltv === null || cac === null || cac === 0) return null;
  return ltv / cac;
}

/** A ratio as "2.4×" in the reader's digits — `toFixed` always writes Latin ones. */
export function multipleText(locale: string, value: number): string {
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${nf.format(value)}×`;
}

/** The plan the actuals are measured against, over `days` of the window. */
export function plannedMinor(budget: Budget, days: number): number {
  if (typeof budget.capMinor === "number") return budget.capMinor;
  if (typeof budget.totalMinor === "number") return budget.totalMinor;
  if (typeof budget.dailyMinor === "number") return budget.dailyMinor * Math.max(days, 1);
  return 0;
}

/** Ascending daily totals — the shape <Sparkline> wants. */
export function dailySpend(rows: readonly SpendRow[]): Array<{ day: string; amountMinor: number }> {
  const days = new Map<string, number>();
  for (const row of rows) days.set(row.day, (days.get(row.day) ?? 0) + (row.amountMinor || 0));
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, amountMinor]) => ({ day, amountMinor }));
}

/** The windows every SIGNAL screen offers. 7 is a week's noise, 90 is a quarter. */
export const WINDOWS = [7, 30, 90] as const;

/** `?days=` as one of the offered windows. Anything else is a month. */
export function windowDays(raw: string | null): number {
  const days = Number(raw);
  return WINDOWS.some((allowed) => allowed === days) ? days : 30;
}

export function monthOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

export interface Cohort {
  /** `YYYY-MM` of the customer's first bind. */
  month: string;
  size: number;
  /** How many of them came back in a later month. */
  retained: number;
}

/**
 * Retention from the touch ledger alone: a cohort is the month a customer first
 * bound, and it is retained if that customer has any touch in a later month.
 * ponytail: a coarse definition (any touch, not a second bind) because binds are
 * rare enough in a young tenant that the strict version is all zeros. Tighten it
 * when AXIS exposes contract renewals per customer.
 */
export function cohorts(touches: readonly TouchRow[]): Cohort[] {
  const first = new Map<string, string>();
  for (const touch of touches) {
    if (!touch.customerId || touch.touchType !== BIND) continue;
    const month = monthOf(touch.ts);
    const known = first.get(touch.customerId);
    if (!known || month < known) first.set(touch.customerId, month);
  }
  const later = new Set<string>();
  for (const touch of touches) {
    if (!touch.customerId) continue;
    const start = first.get(touch.customerId);
    if (start && monthOf(touch.ts) > start) later.add(touch.customerId);
  }
  const rolls = new Map<string, Cohort>();
  for (const [customerId, month] of first) {
    const cohort = rolls.get(month) ?? { month, size: 0, retained: 0 };
    cohort.size += 1;
    if (later.has(customerId)) cohort.retained += 1;
    rolls.set(month, cohort);
  }
  return [...rolls.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export interface AeoRoll {
  total: number;
  published: number;
  stale: number;
  /** Pages an answer engine was actually observed citing. */
  cited: number;
  clusters: number;
  /** Cited as a share of published, 0–100. */
  citationSharePct: number;
}

export function aeoCoverage(pages: readonly AeoRow[]): AeoRoll {
  const published = pages.filter((page) => page.status === "published");
  const cited = pages.filter((page) => citationsOf(page).length > 0);
  return {
    total: pages.length,
    published: published.length,
    stale: pages.filter((page) => page.status === "stale").length,
    cited: cited.length,
    clusters: new Set(pages.map((page) => page.queryCluster)).size,
    citationSharePct: published.length === 0 ? 0 : Math.round((cited.length / published.length) * 100)
  };
}

/**
 * The engines quoting an answer page, as a person names them. `citedByJson` is
 * written by the crawler as a list, and has arrived as bare names, as
 * `{engines:[…]}`, and as sighting records — `{engine, firstSeen, lastSeen}` —
 * which the QUOTED BY column rendered as `[object Object]`. Read all three,
 * trust none.
 */
export function citationsOf(page: AeoRow): string[] {
  const raw = asJson<unknown>(page.citedByJson, []);
  const list = Array.isArray(raw) ? raw : ((raw as { engines?: unknown }).engines ?? []);
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = entry as { engine?: unknown; name?: unknown };
      const named = record?.engine ?? record?.name;
      return typeof named === "string" ? named : "";
    })
    .filter(Boolean)
    .map(engineName);
}

/**
 * Answer engines spell themselves; `humanise` would give "Chatgpt". Anything
 * unknown falls back to title case, which is still a name and not a slug.
 */
const ENGINE_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  claude: "Claude",
  google_ai_overviews: "Google AI Overviews",
  google_sge: "Google AI Overviews",
  grok: "Grok"
};

export function engineName(slug: string): string {
  return (
    ENGINE_NAMES[slug] ??
    slug
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** A page nobody re-verified inside the window is answering from old facts. */
export function isStale(page: AeoRow, now: number, days = 30): boolean {
  if (page.status === "stale") return true;
  if (!page.freshness) return page.status === "published";
  return now - page.freshness > days * 86_400_000;
}

export interface AudienceValue {
  audience: AudienceRow;
  campaigns: number;
  spendMinor: number;
  binds: number;
  valueMinor: number;
  cacMinor: number | null;
  ltvMinor: number | null;
  multiple: number | null;
  /** Binds as a share of the cached audience size, 0–100. */
  conversionPct: number;
}

/**
 * Value per audience. Attribution rows carry a campaign, not an audience, so
 * the campaign is the join: an audience is worth what the campaigns aimed at it
 * bound, and costs what they spent.
 */
export function audienceValue(
  audiences: readonly AudienceRow[],
  campaigns: readonly CampaignRow[],
  spend: readonly SpendRow[],
  touches: readonly TouchRow[]
): AudienceValue[] {
  return audiences
    .map((audience) => {
      const own = campaigns.filter((campaign) => campaign.audienceId === audience.id);
      const ids = new Set(own.map((campaign) => campaign.id));
      const spendMinor = totalSpendMinor(spend.filter((row) => row.campaignId && ids.has(row.campaignId)));
      const mine = touches.filter((touch) => touch.campaignId && ids.has(touch.campaignId));
      const binds = mine.filter((touch) => touch.touchType === BIND);
      const cac = cacMinor(spendMinor, binds.length);
      const ltv = ltvMinor(mine);
      return {
        audience,
        campaigns: own.length,
        spendMinor,
        binds: binds.length,
        valueMinor: binds.reduce((sum, touch) => sum + (touch.valueMinor || 0), 0),
        cacMinor: cac,
        ltvMinor: ltv,
        multiple: ltvToCac(ltv, cac),
        conversionPct:
          audience.sizeCached && audience.sizeCached > 0
            ? Math.round((binds.length / audience.sizeCached) * 10_000) / 100
            : 0
      };
    })
    .sort((a, b) => b.valueMinor - a.valueMinor);
}

/** docs/19: reversing a move is only honest inside the window the move promised. */
export function isReversible(move: MoveRow, now: number): boolean {
  if (move.reversedAt) return false;
  return move.reversibleUntil === null || move.reversibleUntil > now;
}

/** apps/api/src/resources.ts CAMPAIGN_TRANSITIONS — the client mirrors it so the
 *  form only offers states the API will accept. `draft -> live` is legal (J-M1). */
export const CAMPAIGN_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["review", "scheduled", "live", "ended"],
  review: ["draft", "scheduled", "live", "ended"],
  scheduled: ["review", "live", "ended"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: []
};

export function nextStates(state: string): readonly string[] {
  return CAMPAIGN_TRANSITIONS[state] ?? [];
}

/** Compliance has to have cleared a variant before the campaign can carry it. */
export function isPublishable(creative: CreativeRow): boolean {
  return creative.complianceStatus === "passed";
}

/** A campaign with no cleared creative has nothing to say when it goes live. */
export function canLaunch(campaign: CampaignRow, creatives: readonly CreativeRow[]): boolean {
  if (!nextStates(campaign.state).includes("live")) return false;
  return creatives.some((creative) => creative.campaignId === campaign.id && isPublishable(creative));
}

/* --------------------------------------------------------------- experiments */

/** The arms of a test. The column holds a bare array; a wrapped `{variants:[…]}`
 *  is read too so a hand-written row does not render an empty test. */
export function variantsOf(row: ExperimentRow): Variant[] {
  const raw = asJson<unknown>(row.variantsJson, []);
  const list = Array.isArray(raw) ? raw : ((raw as { variants?: unknown }).variants ?? []);
  return Array.isArray(list) ? (list as Variant[]) : [];
}

export function resultOf(row: ExperimentRow): ExperimentResult | null {
  if (row.resultJson === null || row.resultJson === undefined) return null;
  const parsed = asJson<ExperimentResult | null>(row.resultJson, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

/** How many observations the stop was called on, across every arm. */
export function samplesSeen(result: ExperimentResult | null): number {
  return Object.values(result?.samples ?? {}).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
}

/** Progress towards `minSample`, 0-100. Null when nobody set a target. */
export function samplePct(row: ExperimentRow): number | null {
  if (!row.minSample) return null;
  const seen = samplesSeen(resultOf(row));
  return Math.min(100, Math.round((seen / row.minSample) * 100));
}

/** A test only ever moves forward. Mirrors what the decide form may offer;
 *  the API takes any state, so this is the client's own discipline. */
export const EXPERIMENT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["running", "abandoned"],
  running: ["concluded", "abandoned"],
  concluded: [],
  abandoned: []
};

export function nextExperimentStates(state: string): readonly string[] {
  return EXPERIMENT_TRANSITIONS[state] ?? [];
}

/** 95% probability-to-beat-control, in basis points: the line a sequential test
 *  has to cross before a stop counts as a decision rather than a peek. */
export const DECISION_BOUNDARY_BPS = 9_500;

export function crossedBoundary(result: ExperimentResult | null): boolean {
  const p = result?.probabilityToBeatControlBps;
  return typeof p === "number" && p >= DECISION_BOUNDARY_BPS;
}

/** won -> success, lost -> danger, abandoned -> neutral, still open -> info. */
export function verdictTone(row: ExperimentRow): "success" | "danger" | "warning" | "neutral" | "info" {
  const verdict = resultOf(row)?.verdict;
  if (verdict === "won") return "success";
  if (verdict === "lost") return "danger";
  if (verdict === "inconclusive") return "warning";
  if (verdict === "abandoned") return "neutral";
  return "info";
}

/** `quote_start_rate` -> its label, or title-case when this pack never named it. */
export function metricLabel(slug: string, l: Label): string {
  const key = `exp.metric.${slug}`;
  const named = l(key);
  return named === key ? humanise(slug) : named;
}

/* --------------------------------------------------------------------- admin */

/** `signal_campaigns.guardrail_checks_json`, as the compliance pass writes it. */
export interface Guardrails {
  suppressionAudienceApplied?: boolean;
  frequencyCapPerWeek?: number;
  quietHours?: { from?: string; to?: string; tz?: string };
  brandKit?: string;
  bannedClaims?: string;
  checkedAt?: number;
}

/**
 * A campaign that has not been checked has no record at all, not an empty one —
 * so this returns null rather than `{}` and the admin screen can tell "checked,
 * clean" apart from "never checked".
 */
export function guardrailsOf(campaign: CampaignRow): Guardrails | null {
  const bag = asJson<Guardrails | null>(campaign.guardrailChecksJson, null);
  return bag && typeof bag === "object" && !Array.isArray(bag) ? bag : null;
}

/** States in which a campaign is already reaching people, so its checks bind now. */
export const REACHING_STATES: readonly string[] = ["scheduled", "live"];

/** The autonomy levels that spend without asking (packages/db/src/json.ts). */
const UNSUPERVISED: readonly string[] = ["act", "act_and_report"];

/** The audience this one subtracts before it sends. */
export function excludedAudienceId(audience: AudienceRow): string | null {
  const def = asJson<Record<string, unknown>>(audience.definitionJson, {});
  return typeof def.excludeAudienceId === "string" && def.excludeAudienceId ? def.excludeAudienceId : null;
}

/**
 * The audiences that exist to be subtracted: one that asks for no consent
 * purpose at all, or one another audience already excludes. Either way it is a
 * suppression source and must not itself be required to carry an exclusion.
 */
export function suppressionIds(audiences: readonly AudienceRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of audiences) {
    if (row.consentPurposes === "none") ids.add(row.id);
    const excluded = excludedAudienceId(row);
    if (excluded) ids.add(excluded);
  }
  return ids;
}

/**
 * What is wrong when the campaign, guardrail and audience config are read
 * together. Each of these is invisible in the per-table list an admin would
 * otherwise be editing, and each lets a send reach somebody it should not or
 * lets an agent spend with no ceiling.
 */
export function adminFaults(input: {
  campaigns: readonly CampaignRow[];
  audiences: readonly AudienceRow[];
}): Array<{ key: string; ref: string }> {
  const faults: Array<{ key: string; ref: string }> = [];

  for (const campaign of input.campaigns) {
    const guardrails = guardrailsOf(campaign);
    if (REACHING_STATES.includes(campaign.state)) {
      if (!guardrails) faults.push({ key: "admin.fault.unchecked", ref: campaign.name });
      else {
        if (guardrails.bannedClaims && guardrails.bannedClaims !== "pass") {
          faults.push({ key: "admin.fault.bannedClaims", ref: campaign.name });
        }
        if (guardrails.brandKit && guardrails.brandKit !== "pass") {
          faults.push({ key: "admin.fault.brandKit", ref: campaign.name });
        }
        if (guardrails.suppressionAudienceApplied === false) {
          faults.push({ key: "admin.fault.noSuppressionApplied", ref: campaign.name });
        }
      }
    }
    if (UNSUPERVISED.includes(campaign.autonomyLevel) && !budgetOf(campaign).autopilotBoundMinor) {
      faults.push({ key: "admin.fault.unbounded", ref: campaign.name });
    }
  }

  const suppression = suppressionIds(input.audiences);
  if (input.audiences.length > 0 && suppression.size === 0) {
    faults.push({ key: "admin.fault.noSuppressionSource", ref: "" });
  }
  for (const audience of input.audiences) {
    if (suppression.has(audience.id)) continue;
    if (!excludedAudienceId(audience)) faults.push({ key: "admin.fault.noExclusion", ref: audience.name });
  }
  return faults;
}

/* -------------------------------------------------------------------- labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    /* shared */
    approvalTitle: "Waiting for an approver",
    approvalBody: "This change needs a second pair of eyes under policy {policy}. It is queued, not lost.",
    approvalLink: "Open approvals",
    save: "Save",
    cancel: "Cancel",
    saved: "Saved",
    channel: "Channel",
    campaign: "Campaign",
    spend: "Spend",
    plan: "Plan",
    binds: "Signed",
    value: "Value",
    clicks: "Clicks",
    impressions: "Impressions",
    conversions: "Conversions",
    cac: "Cost per acquisition",
    ltv: "Value per customer",
    multiple: "Value to cost",
    state: "State",
    reason: "Reason",
    amount: "Amount",
    when: "When",
    none: "Not enough data yet",
    noPermission: "Your role does not include this view.",
    why: "Why",
    audience: "Audience",
    autonomy: "Autonomy",
    bound: "Per-move ceiling",
    days: "{n} days",
    confirm: "I understand this changes what the agents may spend",

    /* cockpit */
    "cockpit.title": "Growth cockpit",
    "cockpit.lede": "What the money bought this window, and what the agents changed while you were away.",
    "cockpit.spendToDate": "Spent this window",
    "cockpit.againstPlan": "Against plan",
    "cockpit.pipeline": "Pipeline by channel",
    "cockpit.pipelineCaption": "Spend, clicks and signings per channel over the window",
    "cockpit.liveCampaigns": "Running now",
    "cockpit.liveCaption": "Campaigns in a live or paused state",
    "cockpit.changesToday": "What the agents changed",
    "cockpit.changesCaption": "Budget moves the autopilot made, newest first",
    "cockpit.noChanges": "The autopilot has not moved anything in this window.",
    "cockpit.noCampaigns": "Nothing is running.",
    "cockpit.startOne": "Open the campaign studio",
    "cockpit.autopilot": "Autopilot",
    "cockpit.pause": "Pause the autopilot",
    "cockpit.resume": "Resume the autopilot",
    "cockpit.runNow": "Look for a move now",
    "cockpit.paused": "Paused",
    "cockpit.running": "Running",
    "cockpit.adjusted": "The autopilot made {n} move(s).",
    "cockpit.movedBy": "Moved by",
    "cockpit.trend": "Daily spend",
    "cockpit.autopilotWhy":
      "The autopilot compares cost per acquisition across channels over the last seven days and moves budget toward the cheaper one, inside each campaign's per-move ceiling.",
    "cockpit.openBudget": "Budget and bounds",
    "cockpit.openAnalytics": "Growth analytics",

    /* studio */
    "studio.title": "Campaign studio",
    "studio.lede": "Say what you want and who it is for. The model drafts the words, you edit them, then you launch.",
    "studio.step1": "The goal",
    "studio.step2": "The words",
    "studio.step3": "Review",
    "studio.step4": "Launch",
    "studio.step5": "Live",
    "studio.name": "What is this campaign called",
    "studio.objective": "What is it for",
    "studio.audienceHint": "Who it reaches. Leave empty to reach everyone.",
    "studio.audienceAll": "Everyone",
    "studio.channels": "Where it runs",
    "studio.channelsHint": "Tick every place this campaign may buy. The autopilot moves budget between the ones you tick.",
    "studio.daily": "Daily budget",
    "studio.boundHint": "The most the autopilot may move between channels in one decision.",
    "studio.owner": "Who owns it",
    "studio.ownerPick": "Choose a colleague or team",
    "studio.create": "Start the campaign",
    "studio.created": "Draft created. Now give the model a brief.",
    "studio.brief": "Tell the model what to say",
    "studio.briefHint": "The offer, the tone, anything that must appear. The draft is yours to edit.",
    "studio.kind": "What kind of content",
    "studio.count": "How many variants",
    "studio.locales": "Languages",
    "studio.generate": "Draft the content",
    "studio.generating": "Drafting",
    "studio.generated": "{n} draft(s) ready to read.",
    "studio.variants": "Drafts",
    "studio.noVariants": "No drafts yet. Give the model a brief above.",
    "studio.editVariant": "Edit this draft",
    "studio.approve": "Clear this draft",
    "studio.approved": "Cleared",
    "studio.blockedNote": "Compliance blocked this draft. Edit it or discard it.",
    "studio.discard": "Discard",
    "studio.launch": "Launch the campaign",
    "studio.launchHint": "Going live spends money. It is recorded, and it may need an approver.",
    "studio.launchBlocked": "Clear at least one draft before launching.",
    "studio.launched": "The campaign is live.",
    "studio.whyDraft": "Drafted from your brief, the audience definition and the compliance rules for this content type.",
    "studio.pickCampaign": "Or continue a draft",
    "studio.open": "Open",
    "studio.performance": "How it is doing",
    "studio.performanceCaption": "Spend and outcome per channel since launch",
    "studio.noSpend": "No spend recorded yet.",
    "studio.newCampaign": "Start a new one",
    "studio.complianceNote": "Compliance note",
    "studio.pause": "Pause it",

    /* audience value */
    "aud.title": "Audiences and value",
    "aud.lede": "What each audience is worth against what it costs to reach.",
    "aud.caption": "Value, cost and conversion per audience",
    "aud.size": "Size",
    "aud.reach": "Campaigns aimed here",
    "aud.conversion": "Conversion",
    "aud.best": "Best value to cost",
    "aud.worst": "Losing money",
    "aud.totalValue": "Total value signed",
    "aud.unmeasured": "No campaign has aimed at this audience yet.",
    "aud.thin": "Too few signings to trust this number.",
    "aud.openAudiences": "Manage audiences",

    /* answer engines */
    "aeo.title": "Answer engines",
    "aeo.lede": "Which questions you answer, and whether the engines are quoting you.",
    "aeo.caption": "Answer pages by cluster, freshness and citations",
    "aeo.coverage": "Clusters covered",
    "aeo.publishedPages": "Published",
    "aeo.citedPages": "Cited",
    "aeo.share": "Citation share",
    "aeo.stalePages": "Needs re-checking",
    "aeo.cluster": "Question cluster",
    "aeo.citedBy": "Quoted by",
    "aeo.freshness": "Last verified",
    "aeo.never": "Never",
    "aeo.markStale": "Flag for re-checking",
    "aeo.publish": "Publish",
    "aeo.retire": "Retire",
    "aeo.noPages": "No answer pages yet.",
    "aeo.openPages": "Manage answer pages",
    "aeo.staleWarning": "{n} published page(s) have not been verified in 30 days.",

    /* experiments */
    "exp.title": "Experiments",
    "exp.lede": "Every test we ran, what it was for, and what it decided.",
    "exp.caption": "Experiments by state, with the metric each one moves",
    "exp.runningNow": "Running now",
    "exp.decidedCount": "Decided",
    "exp.wonCount": "Won",
    "exp.hypothesis": "Hypothesis",
    "exp.metric": "Metric",
    "exp.state": "State",
    "exp.arms": "Arms",
    "exp.sample": "Sample",
    "exp.verdict": "Verdict",
    "exp.concluded": "Stopped",
    "exp.open": "Open",
    "exp.none": "No experiments yet.",
    "exp.pending": "Still open",
    "exp.noWinner": "No single arm",
    "exp.noTarget": "No target set",
    "exp.state.draft": "Draft",
    "exp.state.running": "Running",
    "exp.state.concluded": "Concluded",
    "exp.state.abandoned": "Abandoned",
    "exp.verdict.won": "Won",
    "exp.verdict.lost": "Lost",
    "exp.verdict.inconclusive": "Inconclusive",
    "exp.verdict.abandoned": "Dropped",
    "exp.detail": "The test in detail",
    "exp.variants": "The arms of this test",
    "exp.variant": "Arm",
    "exp.split": "Traffic share",
    "exp.rate": "Rate",
    "exp.samples": "Observations",
    "exp.control": "Control",
    "exp.winner": "Winner",
    "exp.uplift": "Uplift on control",
    "exp.probability": "Probability it beats control",
    "exp.boundary": "Stopping line at 95%",
    "exp.crossed": "Crossed the line — read this as a decision.",
    "exp.notCrossed": "Short of the line — read this as a lean, not a decision.",
    "exp.stoppedBy": "Stopped by",
    "exp.note": "What we did about it",
    "exp.reason": "Why it was dropped",
    "exp.reach": "Audience it could reach",
    "exp.progress": "Towards {n} observations",
    "exp.noReading": "No reading yet — it is still collecting.",
    "exp.chart": "Sequential test",
    "exp.chartHint": "The reading at the stop, not the path to it: interim snapshots are not kept.",
    "exp.decide": "Record the decision",
    "exp.decideHint":
      "Moving a test out of running writes the verdict with it. Stopping without one leaves the log unreadable later.",
    "exp.newState": "Move it to",
    "exp.verdictField": "Verdict",
    "exp.winnerField": "Which arm won",
    "exp.noteField": "Note for the log",
    "exp.decideSaved": "Decision recorded.",
    "exp.new": "Start a test",
    "exp.newHint": "Two arms, one metric, and the number of observations you will not stop before.",
    "exp.hypothesisField": "What you expect to happen",
    "exp.metricField": "Metric it moves",
    "exp.minSampleField": "Do not stop before",
    "exp.campaignField": "Campaign (optional)",
    "exp.controlField": "Control arm",
    "exp.challengerField": "Challenger arm",
    "exp.create": "Start it",
    "exp.created": "Test created as a draft.",
    "exp.unattached": "No campaign",
    "exp.metric.quote_start_rate": "Quote start rate",
    "exp.metric.click_to_bind_rate": "Click-to-bind rate",
    "exp.metric.renewal_accept_rate": "Renewal acceptance rate",
    "exp.metric.aeo_citation_share": "Answer-engine citation share",

    /* budget */
    "budget.title": "Budget and bounds",
    "budget.lede": "The ceiling on the spend, and how far the agents may move it without asking.",
    "budget.ceiling": "Ceiling",
    "budget.used": "Spent",
    "budget.perCampaign": "Per campaign",
    "budget.caption": "Daily budget, per-move ceiling and autonomy per campaign",
    "budget.setBounds": "Change the bounds",
    "budget.boundsSaved": "Bounds updated.",
    "budget.daily": "Daily budget",
    "budget.autonomyHint": "Ask first, act then tell, or act alone.",
    "budget.moves": "Moves made",
    "budget.movesCaption": "Every budget move, who allowed it and whether it can still be undone",
    "budget.reverse": "Undo this move",
    "budget.reversed": "Undone",
    "budget.reverseWindow": "Can be undone until",
    "budget.reverseHint": "Undoing a move puts the money back where it came from. It is recorded.",
    "budget.noMoves": "No moves yet.",
    "budget.expired": "The window to undo this has closed.",
    "budget.pickCampaign": "Which campaign",
    "budget.headroom": "Headroom",
    "budget.overspend": "Over plan",
    "budget.autoApproved": "Inside its bounds",
    "budget.needsApproval": "Needed an approver",

    /* analytics */
    "growth.title": "Growth analytics",
    "growth.lede": "Cost, value and where the customers actually came from.",
    "growth.blended": "Blended cost per acquisition",
    "growth.blendedLtv": "Blended value per customer",
    "growth.ratio": "Value to cost",
    "growth.ratioHint": "Three or better is a business that can afford to grow.",
    "growth.attribution": "Where they came from",
    "growth.attributionCaption": "Spend, signings and cost per acquisition by channel",
    "growth.cohorts": "Coming back",
    "growth.cohortsCaption": "Customers by the month they first signed, and how many returned",
    "growth.cohort": "First signed",
    "growth.size": "Customers",
    "growth.retained": "Came back",
    "growth.retention": "Return rate",
    "growth.export": "Export",
    "growth.exportHint": "The spend ledger for this window, as a file.",
    "growth.format": "Format",
    "growth.exportReady": "Your file is ready",
    "growth.download": "Download",
    "growth.exportQueued": "Building your file. Reload in a moment.",
    "growth.window": "Window",
    "growth.last7": "Last 7 days",
    "growth.last30": "Last 30 days",
    "growth.last90": "Last 90 days",
    "growth.noSpend": "No spend recorded in this window.",
    "growth.efficiency": "Cost per click",
    /* option values, so a screen never renders a raw enum */
    xlsx: "Excel",
    pdf: "PDF",
    csv: "CSV",
    json: "JSON",
    // packages/db/src/json.ts AutonomyLevel, namespaced because `draft` is also
    // a campaign state and the two mean different things.
    "autonomy.suggest": "Suggest only",
    "autonomy.draft": "Draft, do not send",
    "autonomy.act_with_approval": "Act with approval",
    "autonomy.act": "Act alone",
    "autonomy.act_and_report": "Act and report",
    acq: "Winning new customers",
    renewal: "Keeping customers",
    xsell: "Selling more to customers",
    draft: "Draft",
    review: "In review",
    scheduled: "Scheduled",
    live: "Live",
    paused: "Paused",
    ended: "Ended",
    ad: "Advert",
    lp: "Landing page",
    email: "Email",
    social: "Social post",
    video_script: "Video script",
    pending: "Not checked yet",
    passed: "Cleared",
    flagged: "Flagged",
    blocked: "Blocked",
    published: "Published",
    stale: "Needs re-checking",
    retired: "Retired",
    "locale.en": "English",
    "locale.ar": "Arabic",

    /* refusals — the screen's own validation, keyed by the code the action
       returned so the actor reads a sentence and the log keeps the code */
    "problem.bad_intent": "That control sent something this screen does not do.",
    "problem.campaign_required": "Choose a campaign first.",
    "problem.budget_required": "Give a daily budget.",
    "problem.bound_required": "Give a per-move ceiling.",
    "problem.bound_over_daily": "The per-move ceiling cannot exceed the daily budget.",
    "problem.autonomy_required": "Choose how much the agents may do on their own.",
    "problem.confirm_required": "Tick the confirmation before changing the bounds.",
    "problem.move_required": "Pick the move to undo.",
    "problem.actor_required": "An undo has to be recorded against a person.",
    "problem.name_required": "Give the campaign a name.",
    "problem.objective_required": "Say what the campaign is for.",
    "problem.owner_required": "Name who owns this campaign.",
    "problem.channels_required": "Pick at least one place for it to run.",
    "problem.brief_required": "Write at least a sentence for the model to work from.",
    "problem.kind_required": "Choose what kind of content to draft.",
    "problem.creative_required": "That draft is no longer on this screen. Reload it.",
    "problem.content_required": "A draft cannot be saved empty.",
    "problem.status_required": "Choose the state to move the page to.",
    "problem.page_required": "Pick an answer page first.",
    "problem.format_required": "Choose a file format.",
    "problem.experiment_required": "Pick a test first.",
    "problem.state_required": "Choose the state to move the test to.",
    "problem.verdict_required": "Record the verdict when you stop a test.",
    "problem.hypothesis_required": "Write what you expect to happen.",
    "problem.metric_required": "Say which metric is being measured.",
    "problem.arms_required": "Name both arms.",

    /* admin */
    "admin.title": "SIGNAL admin",
    "admin.lede": "The brand, the claims, the ceilings and the lists everything sent from here is checked against.",
    "admin.denied": "Your role does not include the SIGNAL settings.",
    "admin.readyTitle": "Nothing is stranded.",
    "admin.readyBody": "Every running campaign passed its checks, every agent that spends has a ceiling, and every audience subtracts a suppression list.",
    "admin.fault.unchecked": "Reaching people without ever having passed the brand and claims checks.",
    "admin.fault.bannedClaims": "Running with a claims check that did not pass.",
    "admin.fault.brandKit": "Running with a brand check that did not pass.",
    "admin.fault.noSuppressionApplied": "Running without the suppression list subtracted.",
    "admin.fault.unbounded": "The agents may act on this one, and no per-move ceiling stops them.",
    "admin.fault.noSuppressionSource": "No suppression list exists, so nothing is being held back.",
    "admin.fault.noExclusion": "This audience subtracts no suppression list.",
    "admin.brandTitle": "Brand kit",
    "admin.brandLede": "The name, mark and colour every draft is written and rendered in.",
    "admin.brandName": "Product name",
    "admin.brandAccent": "Accent colour",
    "admin.brandLogos": "Marks supplied",
    "admin.brandDefault": "Platform default",
    "admin.brandEdit": "Edit the brand kit",
    "admin.brandHint": "Settings owns this, and checks the accent for readable contrast before it saves.",
    "admin.guardTitle": "Guardrails and banned claims",
    "admin.guardLede": "What each campaign was checked against, and when it was last checked.",
    "admin.guardCaption": "Guardrail checks per campaign",
    "admin.guardEmpty": "No campaign yet.",
    "admin.guardNone": "Never checked",
    "admin.claims": "Claims",
    "admin.brandCheck": "Brand",
    "admin.suppressionApplied": "Suppression",
    "admin.cap": "Frequency cap",
    "admin.capValue": "{n} per week",
    "admin.quiet": "Quiet hours",
    "admin.checkedAt": "Last checked",
    "admin.pass": "Pass",
    "admin.fail": "Fail",
    "admin.applied": "Applied",
    "admin.notApplied": "Not applied",
    "admin.boundsTitle": "Budget bounds and approvals",
    "admin.boundsLede": "How far the agents may go alone, and what waits for a person.",
    "admin.boundsCaption": "Daily budget, per-move ceiling and autonomy per campaign",
    "admin.boundsEmpty": "No campaign yet.",
    "admin.noBound": "No ceiling",
    "admin.paused": "Autopilot is paused for the whole tenant.",
    "admin.running": "Autopilot is running.",
    "admin.boundsEdit": "Change the bounds",
    "admin.policyTitle": "Approval thresholds",
    "admin.policyLede": "The decisions SIGNAL cannot take alone, and who is allowed to take them.",
    "admin.policyCaption": "SIGNAL approval policies",
    "admin.policyKey": "Decision",
    "admin.policyDecide": "Approver needs",
    "admin.policyDual": "Second pair of eyes",
    "admin.policyThreshold": "Above",
    "admin.policyAuto": "Auto-approved by this tenant",
    "admin.dual.never": "Not required",
    "admin.dual.above_threshold": "Above the threshold",
    "admin.dual.always": "Always",
    "admin.policy.signal.budget_move": "Move budget between campaigns",
    "admin.policy.signal.campaign_launch": "Launch a campaign",
    "admin.policy.signal.creative_publish": "Publish a creative",
    "admin.policy.signal.budget_commit": "Commit spend",
    "admin.policy.signal.boost": "Boost a running campaign",
    "admin.policy.signal.creator_brief": "Send a creator brief",
    "admin.policyEdit": "Open approvals",
    "admin.suppressionTitle": "Suppression sources",
    "admin.suppressionLede": "Who is held back from every send, and which audiences subtract them.",
    "admin.suppressionCaption": "Audiences, their consent basis and the list each one subtracts",
    "admin.suppressionEmpty": "No audience yet.",
    "admin.audienceName": "Audience",
    "admin.consent": "Consent basis",
    "admin.excludes": "Subtracts",
    "admin.isSuppression": "Suppression list",
    "admin.size": "Size",
    "admin.refresh": "Refreshed",
    "admin.suppressionEdit": "Edit audiences",
    "admin.discTitle": "Disclosure wordings",
    "admin.discLede": "The wordings presented to customers, per line and channel. The log is what was shown, and cannot be edited after the fact.",
    "admin.discCaption": "Disclosure wordings in use",
    "admin.discEmpty": "No disclosure has been presented yet.",
    "admin.discKey": "Wording",
    "admin.discLocale": "Language",
    "admin.discChannel": "Channel",
    "admin.discCount": "Times presented",
    "admin.discEdit": "Open the disclosure log",
    "admin.gapTitle": "Not configured here yet",
    "admin.gapLede": "Two things the spec asks of this screen have nowhere to be stored yet, so this screen does not pretend to hold them.",
    "admin.gapChannels": "Channel connections. Ad-account OAuth is not modelled — campaigns name their channels as slugs and spend is recorded against them, but no credential is held.",
    "admin.gapUtm": "UTM schema. Campaign links are tagged by whoever builds them; there is no tenant-wide pattern to enforce."
  },
  ar: {
    /* shared */
    approvalTitle: "بانتظار الموافقة",
    approvalBody: "هذا التغيير يحتاج مراجعة ثانية وفق السياسة {policy}. طلبك في قائمة الانتظار ولم يُفقد.",
    approvalLink: "فتح الموافقات",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم الحفظ",
    channel: "القناة",
    campaign: "الحملة",
    spend: "الإنفاق",
    plan: "الخطة",
    binds: "التعاقدات",
    value: "القيمة",
    clicks: "النقرات",
    impressions: "مرات الظهور",
    conversions: "التحويلات",
    cac: "تكلفة الاستحواذ",
    ltv: "القيمة لكل عميل",
    multiple: "القيمة مقابل التكلفة",
    state: "الوضع",
    reason: "السبب",
    amount: "المبلغ",
    when: "الوقت",
    none: "لا توجد بيانات كافية بعد",
    noPermission: "دورك لا يشمل هذه الشاشة.",
    why: "السبب",
    audience: "الجمهور",
    autonomy: "الاستقلالية",
    bound: "سقف الحركة الواحدة",
    days: "{n} يوم",
    confirm: "أفهم أن هذا يغيّر حدود إنفاق الوكلاء",

    /* cockpit */
    "cockpit.title": "مركز قيادة النمو",
    "cockpit.lede": "ماذا حقّق الإنفاق في هذه الفترة، وما غيّره الوكلاء في غيابك.",
    "cockpit.spendToDate": "المنفق في هذه الفترة",
    "cockpit.againstPlan": "مقابل الخطة",
    "cockpit.pipeline": "المسار حسب القناة",
    "cockpit.pipelineCaption": "الإنفاق والنقرات والتعاقدات لكل قناة خلال الفترة",
    "cockpit.liveCampaigns": "تعمل الآن",
    "cockpit.liveCaption": "الحملات المباشرة أو المتوقفة مؤقتًا",
    "cockpit.changesToday": "ما غيّره الوكلاء",
    "cockpit.changesCaption": "تحويلات الميزانية التي نفّذها الطيار الآلي، الأحدث أولًا",
    "cockpit.noChanges": "لم ينفّذ الطيار الآلي أي تحويل في هذه الفترة.",
    "cockpit.noCampaigns": "لا شيء يعمل حاليًا.",
    "cockpit.startOne": "افتح استوديو الحملات",
    "cockpit.autopilot": "الطيار الآلي",
    "cockpit.pause": "إيقاف الطيار الآلي مؤقتًا",
    "cockpit.resume": "استئناف الطيار الآلي",
    "cockpit.runNow": "ابحث عن تحويل الآن",
    "cockpit.paused": "متوقف مؤقتًا",
    "cockpit.running": "يعمل",
    "cockpit.adjusted": "نفّذ الطيار الآلي {n} تحويلًا.",
    "cockpit.movedBy": "نفّذه",
    "cockpit.trend": "الإنفاق اليومي",
    "cockpit.autopilotWhy":
      "يقارن الطيار الآلي تكلفة الاستحواذ بين القنوات خلال آخر سبعة أيام ويحوّل الميزانية نحو الأرخص، داخل سقف الحركة الواحدة لكل حملة.",
    "cockpit.openBudget": "الميزانية والحدود",
    "cockpit.openAnalytics": "تحليلات النمو",

    /* studio */
    "studio.title": "استوديو الحملات",
    "studio.lede": "قل ما تريد ولمن. النموذج يكتب المسودة، وأنت تحرّرها ثم تطلق الحملة.",
    "studio.step1": "الهدف",
    "studio.step2": "المحتوى",
    "studio.step3": "المراجعة",
    "studio.step4": "الإطلاق",
    "studio.step5": "مباشرة",
    "studio.name": "ما اسم هذه الحملة",
    "studio.objective": "ما الغرض منها",
    "studio.audienceHint": "من تصل إليه. اتركه فارغًا للوصول إلى الجميع.",
    "studio.audienceAll": "الجميع",
    "studio.channels": "أين تعمل",
    "studio.channelsHint": "اختر كل مكان يمكن للحملة الشراء فيه. ينقل الطيار الآلي الميزانية بين ما تختاره.",
    "studio.daily": "الميزانية اليومية",
    "studio.boundHint": "أقصى مبلغ يحوّله الطيار الآلي بين القنوات في قرار واحد.",
    "studio.owner": "من المسؤول عنها",
    "studio.ownerPick": "اختر زميلاً أو فريقاً",
    "studio.create": "ابدأ الحملة",
    "studio.created": "أُنشئت المسودة. أعطِ النموذج الآن موجزًا.",
    "studio.brief": "أخبر النموذج بما يقوله",
    "studio.briefHint": "العرض والنبرة وكل ما يجب أن يظهر. المسودة لك لتحرّرها.",
    "studio.kind": "نوع المحتوى",
    "studio.count": "عدد النسخ",
    "studio.locales": "اللغات",
    "studio.generate": "اكتب المحتوى",
    "studio.generating": "جارٍ الكتابة",
    "studio.generated": "{n} مسودة جاهزة للقراءة.",
    "studio.variants": "المسودات",
    "studio.noVariants": "لا مسودات بعد. أعطِ النموذج موجزًا أعلاه.",
    "studio.editVariant": "حرّر هذه المسودة",
    "studio.approve": "اعتمد هذه المسودة",
    "studio.approved": "معتمدة",
    "studio.blockedNote": "حجب الامتثال هذه المسودة. حرّرها أو استبعدها.",
    "studio.discard": "استبعاد",
    "studio.launch": "أطلق الحملة",
    "studio.launchHint": "الإطلاق يصرف مالًا. يُسجَّل الأمر وقد يحتاج موافقًا.",
    "studio.launchBlocked": "اعتمد مسودة واحدة على الأقل قبل الإطلاق.",
    "studio.launched": "الحملة مباشرة الآن.",
    "studio.whyDraft": "كُتبت من موجزك وتعريف الجمهور وقواعد الامتثال لهذا النوع من المحتوى.",
    "studio.pickCampaign": "أو أكمل مسودة قائمة",
    "studio.open": "فتح",
    "studio.performance": "كيف تسير",
    "studio.performanceCaption": "الإنفاق والنتيجة لكل قناة منذ الإطلاق",
    "studio.noSpend": "لم يُسجَّل أي إنفاق بعد.",
    "studio.newCampaign": "ابدأ حملة جديدة",
    "studio.complianceNote": "ملاحظة الامتثال",
    "studio.pause": "أوقفها مؤقتًا",

    /* audience value */
    "aud.title": "الجماهير والقيمة",
    "aud.lede": "قيمة كل جمهور مقابل تكلفة الوصول إليه.",
    "aud.caption": "القيمة والتكلفة ومعدل التحويل لكل جمهور",
    "aud.size": "الحجم",
    "aud.reach": "حملات موجّهة إليه",
    "aud.conversion": "التحويل",
    "aud.best": "أفضل قيمة مقابل التكلفة",
    "aud.worst": "يخسر مالًا",
    "aud.totalValue": "إجمالي القيمة المتعاقدة",
    "aud.unmeasured": "لم توجّه أي حملة إلى هذا الجمهور بعد.",
    "aud.thin": "التعاقدات أقل من أن يُعتمد عليها.",
    "aud.openAudiences": "إدارة الجماهير",

    /* answer engines */
    "aeo.title": "محرّكات الإجابة",
    "aeo.lede": "أي الأسئلة تجيب عنها، وهل تنقل عنك المحرّكات.",
    "aeo.caption": "صفحات الإجابات حسب المجموعة والحداثة والاقتباسات",
    "aeo.coverage": "المجموعات المغطّاة",
    "aeo.publishedPages": "منشورة",
    "aeo.citedPages": "مُقتبسة",
    "aeo.share": "نسبة الاقتباس",
    "aeo.stalePages": "تحتاج تحققًا",
    "aeo.cluster": "مجموعة الأسئلة",
    "aeo.citedBy": "نقل عنها",
    "aeo.freshness": "آخر تحقق",
    "aeo.never": "أبدًا",
    "aeo.markStale": "علّمها للتحقق",
    "aeo.publish": "نشر",
    "aeo.retire": "سحب",
    "aeo.noPages": "لا صفحات إجابات بعد.",
    "aeo.openPages": "إدارة صفحات الإجابات",
    "aeo.staleWarning": "{n} صفحة منشورة لم تُتحقّق منها خلال ٣٠ يومًا.",

    /* experiments */
    "exp.title": "التجارب",
    "exp.lede": "كل اختبار أجريناه، وغرضه، وما انتهى إليه.",
    "exp.caption": "التجارب حسب الحالة والمقياس الذي تحرّكه",
    "exp.runningNow": "تعمل الآن",
    "exp.decidedCount": "محسومة",
    "exp.wonCount": "رابحة",
    "exp.hypothesis": "الفرضية",
    "exp.metric": "المقياس",
    "exp.state": "الحالة",
    "exp.arms": "الأذرع",
    "exp.sample": "العيّنة",
    "exp.verdict": "الحكم",
    "exp.concluded": "توقّفت",
    "exp.open": "فتح",
    "exp.none": "لا توجد تجارب بعد.",
    "exp.pending": "ما زالت مفتوحة",
    "exp.noWinner": "لا ذراع فائزة",
    "exp.noTarget": "لا هدف محدّد",
    "exp.state.draft": "مسودة",
    "exp.state.running": "قيد التشغيل",
    "exp.state.concluded": "منتهية",
    "exp.state.abandoned": "متروكة",
    "exp.verdict.won": "ربحت",
    "exp.verdict.lost": "خسرت",
    "exp.verdict.inconclusive": "غير حاسمة",
    "exp.verdict.abandoned": "أُسقطت",
    "exp.detail": "تفاصيل الاختبار",
    "exp.variants": "أذرع هذا الاختبار",
    "exp.variant": "الذراع",
    "exp.split": "حصة الزيارات",
    "exp.rate": "المعدّل",
    "exp.samples": "المشاهدات",
    "exp.control": "الضابطة",
    "exp.winner": "الفائز",
    "exp.uplift": "الفارق عن الضابطة",
    "exp.probability": "احتمال تفوّقها على الضابطة",
    "exp.boundary": "خط التوقّف عند ٩٥٪",
    "exp.crossed": "تجاوزت الخط — اقرأها قرارًا.",
    "exp.notCrossed": "دون الخط — اقرأها ميلًا لا قرارًا.",
    "exp.stoppedBy": "أوقفها",
    "exp.note": "ما فعلناه بناءً عليها",
    "exp.reason": "سبب تركها",
    "exp.reach": "الجمهور الذي يمكن بلوغه",
    "exp.progress": "من أصل {n} مشاهدة",
    "exp.noReading": "لا قراءة بعد — ما زالت تجمع.",
    "exp.chart": "الاختبار التتابعي",
    "exp.chartHint": "القراءة عند التوقّف لا مسارها: اللقطات المرحلية لا تُحفظ.",
    "exp.decide": "سجّل القرار",
    "exp.decideHint": "إخراج الاختبار من التشغيل يكتب الحكم معه. التوقّف دون حكم يترك السجل غير مفهوم لاحقًا.",
    "exp.newState": "انقله إلى",
    "exp.verdictField": "الحكم النهائي",
    "exp.winnerField": "الذراع الفائزة",
    "exp.noteField": "ملاحظة للسجل",
    "exp.decideSaved": "سُجّل القرار.",
    "exp.new": "ابدأ اختبارًا",
    "exp.newHint": "ذراعان، ومقياس واحد، وعدد مشاهدات لن تتوقّف قبله.",
    "exp.hypothesisField": "ما تتوقّع حدوثه",
    "exp.metricField": "المقياس الذي تحرّكه",
    "exp.minSampleField": "لا تتوقّف قبل",
    "exp.campaignField": "الحملة (اختياري)",
    "exp.controlField": "اسم الذراع الضابطة",
    "exp.challengerField": "اسم الذراع المنافسة",
    "exp.create": "ابدأها",
    "exp.created": "أُنشئ الاختبار كمسودة.",
    "exp.unattached": "بلا حملة",
    "exp.metric.quote_start_rate": "معدّل بدء التسعير",
    "exp.metric.click_to_bind_rate": "معدّل التحوّل من نقرة إلى تعاقد",
    "exp.metric.renewal_accept_rate": "معدّل قبول التجديد",
    "exp.metric.aeo_citation_share": "نسبة الاقتباس في محرّكات الإجابة",

    /* budget */
    "budget.title": "الميزانية والحدود",
    "budget.lede": "سقف الإنفاق، وإلى أي حد يحرّكه الوكلاء دون سؤال.",
    "budget.ceiling": "السقف",
    "budget.used": "المنفق",
    "budget.perCampaign": "لكل حملة",
    "budget.caption": "الميزانية اليومية وسقف الحركة والاستقلالية لكل حملة",
    "budget.setBounds": "تغيير الحدود",
    "budget.boundsSaved": "تم تحديث الحدود.",
    "budget.daily": "الميزانية اليومية",
    "budget.autonomyHint": "يسأل أولًا، أو ينفّذ ثم يبلّغ، أو ينفّذ وحده.",
    "budget.moves": "التحويلات المنفّذة",
    "budget.movesCaption": "كل تحويل ميزانية، ومن أجازه، وهل ما زال قابلًا للعكس",
    "budget.reverse": "اعكس هذا التحويل",
    "budget.reversed": "معكوس",
    "budget.reverseWindow": "قابل للعكس حتى",
    "budget.reverseHint": "عكس التحويل يعيد المال إلى مصدره. يُسجَّل الأمر.",
    "budget.noMoves": "لا تحويلات بعد.",
    "budget.expired": "انتهت مدة عكس هذا التحويل.",
    "budget.pickCampaign": "أي حملة",
    "budget.headroom": "المتبقي",
    "budget.overspend": "تجاوز الخطة",
    "budget.autoApproved": "داخل حدوده",
    "budget.needsApproval": "احتاج موافقًا",

    /* analytics */
    "growth.title": "تحليلات النمو",
    "growth.lede": "التكلفة والقيمة ومن أين جاء العملاء فعلًا.",
    "growth.blended": "متوسط تكلفة الاستحواذ",
    "growth.blendedLtv": "متوسط القيمة لكل عميل",
    "growth.ratio": "القيمة مقابل التكلفة",
    "growth.ratioHint": "ثلاثة أو أكثر يعني عملًا يقدر على النمو.",
    "growth.attribution": "من أين جاؤوا",
    "growth.attributionCaption": "الإنفاق والتعاقدات وتكلفة الاستحواذ حسب القناة",
    "growth.cohorts": "العائدون",
    "growth.cohortsCaption": "العملاء حسب شهر أول تعاقد، وكم منهم عاد",
    "growth.cohort": "أول تعاقد",
    "growth.size": "العملاء",
    "growth.retained": "عادوا",
    "growth.retention": "نسبة العودة",
    "growth.export": "تصدير",
    "growth.exportHint": "سجل الإنفاق لهذه الفترة، كملف.",
    "growth.format": "الصيغة",
    "growth.exportReady": "ملفك جاهز",
    "growth.download": "تنزيل",
    "growth.exportQueued": "جارٍ بناء الملف. أعد التحميل بعد لحظات.",
    "growth.window": "الفترة",
    "growth.last7": "آخر ٧ أيام",
    "growth.last30": "آخر ٣٠ يومًا",
    "growth.last90": "آخر ٩٠ يومًا",
    "growth.noSpend": "لا إنفاق مسجّل في هذه الفترة.",
    "growth.efficiency": "تكلفة النقرة",
    xlsx: "إكسل",
    pdf: "بي دي إف",
    csv: "سي إس في",
    json: "جيسون",
    "autonomy.suggest": "يقترح فقط",
    "autonomy.draft": "يكتب مسودة دون إرسال",
    "autonomy.act_with_approval": "ينفّذ بموافقة",
    "autonomy.act": "ينفّذ وحده",
    "autonomy.act_and_report": "ينفّذ ويبلّغ",
    acq: "استقطاب عملاء جدد",
    renewal: "الحفاظ على العملاء",
    xsell: "بيع المزيد للعملاء",
    draft: "مسودة",
    review: "قيد المراجعة",
    scheduled: "مجدولة",
    live: "مباشرة",
    paused: "متوقفة مؤقتًا",
    ended: "منتهية",
    ad: "إعلان",
    lp: "صفحة هبوط",
    email: "بريد إلكتروني",
    social: "منشور اجتماعي",
    video_script: "نص فيديو",
    pending: "لم تُفحص بعد",
    passed: "معتمدة",
    flagged: "مُعلَّمة",
    blocked: "محظورة",
    published: "منشورة",
    stale: "تحتاج تحققًا",
    retired: "مسحوبة",
    "locale.en": "الإنجليزية",
    "locale.ar": "العربية",

    /* refusals */
    "problem.bad_intent": "أرسل هذا الزر أمرًا لا تنفّذه هذه الشاشة.",
    "problem.campaign_required": "اختر حملة أولًا.",
    "problem.budget_required": "أدخل ميزانية يومية.",
    "problem.bound_required": "أدخل سقفًا للحركة الواحدة.",
    "problem.bound_over_daily": "سقف الحركة الواحدة لا يجوز أن يتجاوز الميزانية اليومية.",
    "problem.autonomy_required": "حدّد ما يجوز للوكلاء فعله وحدهم.",
    "problem.confirm_required": "علّم خانة التأكيد قبل تغيير الحدود.",
    "problem.move_required": "اختر التحويل المطلوب عكسه.",
    "problem.actor_required": "لا بد من تسجيل العكس باسم شخص.",
    "problem.name_required": "أعطِ الحملة اسمًا.",
    "problem.objective_required": "بيّن الغرض من الحملة.",
    "problem.owner_required": "حدّد المسؤول عن هذه الحملة.",
    "problem.channels_required": "اختر مكانًا واحدًا على الأقل لتشغيلها.",
    "problem.brief_required": "اكتب جملة على الأقل ليعمل النموذج عليها.",
    "problem.kind_required": "اختر نوع المحتوى المطلوب كتابته.",
    "problem.creative_required": "هذه المسودة لم تبقَ على الشاشة. أعد التحميل.",
    "problem.content_required": "لا يمكن حفظ مسودة فارغة.",
    "problem.status_required": "اختر الوضع الذي تنقل الصفحة إليه.",
    "problem.page_required": "اختر صفحة إجابة أولًا.",
    "problem.format_required": "اختر صيغة الملف.",
    "problem.experiment_required": "اختر اختبارًا أولًا.",
    "problem.state_required": "اختر الحالة التي تنقل الاختبار إليها.",
    "problem.verdict_required": "سجّل الحكم عند إيقاف الاختبار.",
    "problem.hypothesis_required": "اكتب ما تتوقّع حدوثه.",
    "problem.metric_required": "حدّد المقياس المقاس.",
    "problem.arms_required": "سمِّ الذراعين.",

    /* admin */
    "admin.title": "إدارة SIGNAL",
    "admin.lede": "العلامة والادعاءات والسقوف والقوائم التي يُقاس عليها كل ما يُرسل من هنا.",
    "admin.denied": "دورك لا يشمل إعدادات SIGNAL.",
    "admin.readyTitle": "لا شيء معطّل.",
    "admin.readyBody": "كل حملة تعمل اجتازت فحوصها، ولكل وكيل ينفق سقف، وكل جمهور يطرح قائمة استبعاد.",
    "admin.fault.unchecked": "تصل إلى الناس دون أن تجتاز فحص العلامة والادعاءات ولو مرة.",
    "admin.fault.bannedClaims": "تعمل وفحص الادعاءات لم يُجتَز.",
    "admin.fault.brandKit": "تعمل وفحص العلامة لم يُجتَز.",
    "admin.fault.noSuppressionApplied": "تعمل دون طرح قائمة الاستبعاد.",
    "admin.fault.unbounded": "الوكلاء يتصرفون فيها بلا سقف لكل حركة يوقفهم.",
    "admin.fault.noSuppressionSource": "لا توجد قائمة استبعاد، فلا أحد يُستبعد.",
    "admin.fault.noExclusion": "هذا الجمهور لا يطرح أي قائمة استبعاد.",
    "admin.brandTitle": "هوية العلامة",
    "admin.brandLede": "الاسم والشعار واللون الذي تُكتب وتُعرض به كل المسودات.",
    "admin.brandName": "اسم المنتج",
    "admin.brandAccent": "لون التمييز",
    "admin.brandLogos": "الشعارات المتوفرة",
    "admin.brandDefault": "الافتراضي للمنصة",
    "admin.brandEdit": "تحرير هوية العلامة",
    "admin.brandHint": "الإعدادات تملك هذا، وتتحقق من تباين اللون قبل الحفظ.",
    "admin.guardTitle": "الضوابط والادعاءات الممنوعة",
    "admin.guardLede": "ما فُحصت عليه كل حملة، ومتى كان آخر فحص.",
    "admin.guardCaption": "فحوص الضوابط لكل حملة",
    "admin.guardEmpty": "لا توجد حملة بعد.",
    "admin.guardNone": "لم تُفحص قط",
    "admin.claims": "الادعاءات",
    "admin.brandCheck": "العلامة",
    "admin.suppressionApplied": "الاستبعاد",
    "admin.cap": "سقف التكرار",
    "admin.capValue": "{n} أسبوعيًا",
    "admin.quiet": "ساعات الهدوء",
    "admin.checkedAt": "آخر فحص",
    "admin.pass": "اجتاز",
    "admin.fail": "لم يجتز",
    "admin.applied": "مطبّق",
    "admin.notApplied": "غير مطبّق",
    "admin.boundsTitle": "حدود الميزانية والموافقات",
    "admin.boundsLede": "إلى أي مدى يمضي الوكلاء وحدهم، وما الذي ينتظر إنسانًا.",
    "admin.boundsCaption": "الميزانية اليومية وسقف الحركة ومستوى الاستقلالية لكل حملة",
    "admin.boundsEmpty": "لا توجد حملة بعد.",
    "admin.noBound": "بلا سقف",
    "admin.paused": "الطيار الآلي متوقف للمستأجر بأكمله.",
    "admin.running": "الطيار الآلي يعمل.",
    "admin.boundsEdit": "تغيير الحدود",
    "admin.policyTitle": "عتبات الموافقة",
    "admin.policyLede": "القرارات التي لا تتخذها SIGNAL وحدها، ومن يحق له اتخاذها.",
    "admin.policyCaption": "سياسات موافقة SIGNAL",
    "admin.policyKey": "القرار",
    "admin.policyDecide": "صلاحية المُوافِق",
    "admin.policyDual": "مراجعة ثانية",
    "admin.policyThreshold": "فوق",
    "admin.policyAuto": "يوافق عليه هذا المستأجر تلقائيًا",
    "admin.dual.never": "غير مطلوبة",
    "admin.dual.above_threshold": "فوق العتبة",
    "admin.dual.always": "دائمًا",
    "admin.policy.signal.budget_move": "نقل ميزانية بين الحملات",
    "admin.policy.signal.campaign_launch": "إطلاق حملة",
    "admin.policy.signal.creative_publish": "نشر مادة إبداعية",
    "admin.policy.signal.budget_commit": "الالتزام بإنفاق",
    "admin.policy.signal.boost": "تعزيز حملة قائمة",
    "admin.policy.signal.creator_brief": "إرسال موجز لصانع محتوى",
    "admin.policyEdit": "فتح الموافقات",
    "admin.suppressionTitle": "مصادر الاستبعاد",
    "admin.suppressionLede": "من يُستبعد من كل إرسال، وأي الجماهير تطرحهم.",
    "admin.suppressionCaption": "الجماهير وأساس الموافقة والقائمة التي يطرحها كل منها",
    "admin.suppressionEmpty": "لا يوجد جمهور بعد.",
    "admin.audienceName": "الجمهور",
    "admin.consent": "أساس الموافقة",
    "admin.excludes": "يطرح",
    "admin.isSuppression": "قائمة استبعاد",
    "admin.size": "الحجم",
    "admin.refresh": "آخر تحديث",
    "admin.suppressionEdit": "تحرير الجماهير",
    "admin.discTitle": "صيغ الإفصاح",
    "admin.discLede": "الصيغ المعروضة على العملاء لكل خط وقناة. السجل هو ما عُرض فعلًا، ولا يُعدّل لاحقًا.",
    "admin.discCaption": "صيغ الإفصاح المستخدمة",
    "admin.discEmpty": "لم يُعرض أي إفصاح بعد.",
    "admin.discKey": "الصيغة",
    "admin.discLocale": "اللغة",
    "admin.discChannel": "القناة",
    "admin.discCount": "مرات العرض",
    "admin.discEdit": "فتح سجل الإفصاح",
    "admin.gapTitle": "غير مهيّأ هنا بعد",
    "admin.gapLede": "أمران تطلبهما المواصفة من هذه الشاشة لا مكان لتخزينهما بعد، فلا تدّعي الشاشة أنها تحفظهما.",
    "admin.gapChannels": "ربط القنوات. لا يوجد نموذج لتفويض حسابات الإعلانات — الحملات تسمي قنواتها كرموز ويُسجَّل الإنفاق عليها، لكن لا يُحفظ أي اعتماد.",
    "admin.gapUtm": "مخطط UTM. تُوسم روابط الحملات بمن يبنيها، ولا يوجد نمط موحّد على مستوى المستأجر يُفرض."
  }
};

export type Label = (key: string, vars?: Record<string, string>) => string;

/**
 * The labeller for every SIGNAL screen. The domain pack answers first (CLAUDE.md
 * §14) so a retail tenant's nouns land here too, then the local table, then the
 * key itself — a missing label renders as its key rather than as nothing.
 */
export function labelsIn(locale: string, pack?: string): Label {
  const table = LABELS[locale] ?? LABELS.en!;
  const fallback = LABELS.en!;
  const word = vocabulary(pack, locale);
  return (key, vars) => {
    const text = pseudoText(locale, word(key) ?? table[key] ?? fallback[key] ?? key);
    return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : text;
  };
}

/** The keys the label table answers, for the parity test. */
export const LABEL_KEYS = LABELS;

/**
 * A refusal with a sentence in front of it. The action returns machine codes so
 * the tests and the log can assert on them; `Gate` renders `title`, so the title
 * is swapped for the actor's language when this screen knows the code. Anything
 * from the API keeps its own title.
 */
export function explain(problem: Problemish, l: Label): Problemish {
  const key = problem.code ? `problem.${problem.code}` : "";
  return key && LABELS.en![key] ? { ...problem, title: l(key) } : problem;
}
