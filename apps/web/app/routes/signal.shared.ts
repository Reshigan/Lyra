import { vocabulary } from "../modules/vocabulary";
import { pseudoText } from "../i18n";

// The six bespoke SIGNAL screens share one labeller and one set of derivations,
// for the same reason ledger.shared.ts exists: the cockpit, the studio, the
// budget bounds, the growth numbers, the audience value view and the answer-
// engine coverage all read the same four ledgers (spend, attribution, campaigns,
// budget moves) and would otherwise each grow their own copy of CAC.
//
// Labels are local rather than app/i18n: those catalogues are shared across
// agents and these words belong to these screens. Keys are namespaced by screen
// (`cockpit.*`, `studio.*`, `budget.*`, `growth.*`, `aud.*`, `aeo.*`); the
// unnamespaced ones are shared by all six.
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

/** A channel slug as a person reads it — `google_search` → "Google Search". */
export function channelLabel(slug: string, locale = "en"): string {
  const known = SIGNAL_CHANNELS.find((channel) => channel.slug === slug);
  if (known) return locale.startsWith("ar") ? known.ar : known.en;
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

export function totalSpendMinor(rows: readonly SpendRow[]): number {
  return rows.reduce((sum, row) => sum + (row.amountMinor || 0), 0);
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

/** `citedByJson` is written by the crawler as a list of engine names, and has
 *  arrived as both a bare array and `{engines:[…]}`. Read both, trust neither. */
export function citationsOf(page: AeoRow): string[] {
  const raw = asJson<unknown>(page.citedByJson, []);
  const list = Array.isArray(raw) ? raw : ((raw as { engines?: unknown }).engines ?? []);
  return Array.isArray(list) ? list.map((entry) => String(entry)).filter(Boolean) : [];
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
    "problem.format_required": "Choose a file format."
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
    "problem.format_required": "اختر صيغة الملف."
  }
};

export type Label = (key: string, vars?: Record<string, string>) => string;

/**
 * The labeller for all six screens. The domain pack answers first (CLAUDE.md
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
