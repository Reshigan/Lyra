import { vocabulary } from "../modules/vocabulary";
import { pseudoText } from "../i18n";

// The five bespoke SCOUT screens share one labeller and one set of derivations,
// for the same reason signal.shared.ts exists: the radar, the panel view, the
// price benchmarks, the experiment board and the pricing analytics all read the
// same four tables (scout_clusters, scout_whitespaces, scout_panel_bench,
// scout_experiments) and would otherwise each grow their own copy of "what does
// a price index mean".
//
// Labels are local rather than app/i18n: those catalogues are shared across
// agents and these words belong to these screens. Keys are namespaced by screen
// (`radar.*`, `panel.*`, `price.*`, `xp.*`, `an.*`); the unnamespaced ones are
// shared by all five. `insurer` deliberately goes through the domain pack
// (CLAUDE.md §14) — a bench row's counterparty is a supplier outside insurance.
//
// Nothing here invents a number. The panel bench stores basis points against
// the panel median (10000 = median, see packages/core/src/seed/scout.ts) and win
// rate as whole percent; every roll-up below is a volume weighting of those two
// columns, and a null column stays null rather than becoming a zero.

/* ------------------------------------------------------------- permissions */

/** The exact strings the SCOUT handlers call require_() with. */
export const PERM = {
  clustersRead: "scout:clusters:read",
  signalsRead: "scout:signals:read",
  whitespacesRead: "scout:whitespaces:read",
  /** Promote *and* the whitespace sweep *and* the negotiation pack. */
  whitespacesPromote: "scout:whitespaces:promote",
  panelRead: "scout:panel_bench:read",
  experimentsRead: "scout:experiments:read",
  experimentsCreate: "scout:experiments:create",
  experimentsDecide: "scout:experiments:decide",
  exportCreate: "analytics:exports:create"
} as const;

/** packages/core/src/k-anonymity.ts DEFAULT_K_FLOOR — resources.ts hides any
 *  bench cut below it, so a thin period is absent rather than wrong. */
export const K_FLOOR = 20;

/* ------------------------------------------------------------------ shapes */

/** apps/api/src/crud.ts list envelope. */
export interface Page<T> {
  data: T[];
  cursor?: string;
  total?: number;
}

export interface ClusterRow {
  id: string;
  theme: string;
  summary: string | null;
  momentumScore: number;
  size: number;
  firstSeen: number;
  lastSeen: number;
  trailJson: string | null;
  updatedAt: number;
}

export interface WhitespaceRow {
  id: string;
  description: string;
  category: string | null;
  clusterId: string | null;
  evidenceRefsJson: string | null;
  demandEstimate: number | null;
  competitionScore: number | null;
  status: string;
  owner: string | null;
  promotedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PanelRow {
  id: string;
  providerId: string;
  line: string;
  period: string;
  /** Basis points against the panel median; 10000 is the median. */
  ourPriceIdx: number | null;
  marketPriceIdx: number | null;
  /** Whole percent of the requests this row was quoted into. */
  winRate: number | null;
  volume: number;
  coverageGapsJson: string | null;
  updatedAt: number;
}

export interface ExperimentRow {
  id: string;
  whitespaceId: string;
  landingRef: string | null;
  trafficPlanJson: string | null;
  resultsJson: string | null;
  state: string;
  startedAt: number | null;
  concludedAt: number | null;
  createdAt: number;
}

/** RFC 9457 plus the two extras apps/api adds on an approval gate. */
export interface Problemish {
  title: string;
  status: number;
  code?: string;
  detail?: string;
  policy_key?: string;
}

/* ----------------------------------------------------------------- plumbing */

/** A withheld read must not blank the page: one 403 costs one panel. */
export async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

export const emptyPage = <T,>(): Page<T> => ({ data: [] });

/** One key per load, so a double-submitted form is one write. */
export function mintKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

/** A JSON text column, or the fallback when it is absent or malformed. */
export function asJson<T>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === "object") return raw as T;
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------- panel roll-ups */

/** Volume-weighted mean of a nullable column; null when nothing is priced. */
export function weighted(rows: readonly PanelRow[], pick: (row: PanelRow) => number | null): number | null {
  let sum = 0;
  let mass = 0;
  for (const row of rows) {
    const value = pick(row);
    // A weight of zero would silently drop a real row, so an unpriced or
    // zero-volume cut is excluded rather than counted as the mean.
    if (value === null || row.volume <= 0) continue;
    sum += value * row.volume;
    mass += row.volume;
  }
  return mass > 0 ? Math.round(sum / mass) : null;
}

/** `YYYY-MM` sorts lexically, which is the whole reason the column is text. */
export function latestPeriod(rows: readonly PanelRow[]): string | null {
  return rows.reduce<string | null>((best, row) => (best === null || row.period > best ? row.period : best), null);
}

export function inPeriod(rows: readonly PanelRow[], period: string | null): PanelRow[] {
  return period === null ? [] : rows.filter((row) => row.period === period);
}

export interface ProviderRoll {
  providerId: string;
  volume: number;
  /** 0–1 of the period's total volume. */
  share: number;
  winRate: number | null;
  ourIdx: number | null;
  marketIdx: number | null;
  lines: string[];
  /** Terms where our wording differs from the panel median. */
  gaps: number;
}

export function rollByProvider(rows: readonly PanelRow[]): ProviderRoll[] {
  const total = rows.reduce((sum, row) => sum + row.volume, 0);
  const groups = new Map<string, PanelRow[]>();
  for (const row of rows) groups.set(row.providerId, [...(groups.get(row.providerId) ?? []), row]);
  return [...groups.entries()]
    .map(([providerId, own]) => ({
      providerId,
      volume: own.reduce((sum, row) => sum + row.volume, 0),
      share: total > 0 ? own.reduce((sum, row) => sum + row.volume, 0) / total : 0,
      winRate: weighted(own, (row) => row.winRate),
      ourIdx: weighted(own, (row) => row.ourPriceIdx),
      marketIdx: weighted(own, (row) => row.marketPriceIdx),
      lines: [...new Set(own.map((row) => row.line))].sort(),
      gaps: own.reduce((sum, row) => sum + asJson<unknown[]>(row.coverageGapsJson, []).length, 0)
    }))
    .sort((a, b) => b.volume - a.volume);
}

/** Percent above (positive) or below (negative) the panel median. */
export function deltaPct(ourIdx: number | null, marketIdx: number | null): number | null {
  if (ourIdx === null || marketIdx === null || marketIdx === 0) return null;
  return ((ourIdx - marketIdx) / marketIdx) * 100;
}

/** Two points of index is inside the noise of a median over four quotes. */
export const AT_MARKET_PCT = 2;

/** Label key for where a cut sits, and the tone that carries it. */
export function positionOf(pct: number | null): { key: string; tone: "success" | "neutral" | "danger" } {
  if (pct === null) return { key: "panel.unpriced", tone: "neutral" };
  if (pct <= -AT_MARKET_PCT) return { key: "panel.cheaper", tone: "success" };
  if (pct >= AT_MARKET_PCT) return { key: "panel.dearer", tone: "danger" };
  return { key: "panel.atMarket", tone: "neutral" };
}

/** Basis points as the index the analysts quote: 9420 → "0.94". */
export function indexText(bp: number | null, locale = "en"): string | null {
  return bp === null ? null : (bp / 10_000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* --------------------------------------------------------- price benchmarks */

export interface LineBench {
  line: string;
  volume: number;
  ourIdx: number | null;
  marketIdx: number | null;
  pct: number | null;
}

export function rollByLine(rows: readonly PanelRow[]): LineBench[] {
  const groups = new Map<string, PanelRow[]>();
  for (const row of rows) groups.set(row.line, [...(groups.get(row.line) ?? []), row]);
  return [...groups.entries()]
    .map(([line, own]) => {
      const ourIdx = weighted(own, (row) => row.ourPriceIdx);
      const marketIdx = weighted(own, (row) => row.marketPriceIdx);
      return {
        line,
        volume: own.reduce((sum, row) => sum + row.volume, 0),
        ourIdx,
        marketIdx,
        pct: deltaPct(ourIdx, marketIdx)
      };
    })
    .sort((a, b) => b.volume - a.volume);
}

export interface Loss {
  providerId: string;
  line: string;
  pct: number;
  volume: number;
}

/** The provider × line cuts sitting above the median, dearest first. */
export function losses(rows: readonly PanelRow[]): Loss[] {
  return rows
    .flatMap((row) => {
      const pct = deltaPct(row.ourPriceIdx, row.marketPriceIdx);
      return pct === null || pct <= 0 ? [] : [{ providerId: row.providerId, line: row.line, pct, volume: row.volume }];
    })
    .sort((a, b) => b.pct - a.pct);
}

/* ------------------------------------------------------ pricing analytics */

export interface Elasticity {
  providerId: string;
  line: string;
  fromPeriod: string;
  toPeriod: string;
  /** Change in our index, in percent of the median. */
  idxPct: number;
  /** Change in win rate, in percentage points. */
  winDelta: number;
  /** Win-rate points gained per percent of price cut. Null when price held. */
  ratio: number | null;
}

/**
 * Two consecutive periods of the same provider × line is the only elasticity
 * this data can support — there is no experiment that moved price on purpose,
 * so this is an observation, not a measured curve. A cut with one period is
 * omitted rather than compared against itself.
 */
export function elasticities(rows: readonly PanelRow[]): Elasticity[] {
  const groups = new Map<string, PanelRow[]>();
  for (const row of rows) {
    const key = `${row.providerId}\0${row.line}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: Elasticity[] = [];
  for (const own of groups.values()) {
    const priced = own
      .filter((row) => row.ourPriceIdx !== null && row.marketPriceIdx !== null && row.winRate !== null)
      .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    if (priced.length < 2) continue;
    const before = priced[priced.length - 2]!;
    const after = priced[priced.length - 1]!;
    const idxPct = deltaPct(after.ourPriceIdx, before.ourPriceIdx);
    if (idxPct === null) continue;
    const winDelta = after.winRate! - before.winRate!;
    out.push({
      providerId: after.providerId,
      line: after.line,
      fromPeriod: before.period,
      toPeriod: after.period,
      idxPct,
      winDelta,
      // A price that did not move cannot explain a win rate that did.
      ratio: Math.abs(idxPct) < 0.01 ? null : winDelta / -idxPct
    });
  }
  return out.sort((a, b) => Math.abs(b.winDelta) - Math.abs(a.winDelta));
}

/** Volume share of the priced cuts that sit at or below the panel median. */
export function adequacy(rows: readonly PanelRow[]): { atOrBelow: number; priced: number } {
  let atOrBelow = 0;
  let priced = 0;
  for (const row of rows) {
    const pct = deltaPct(row.ourPriceIdx, row.marketPriceIdx);
    if (pct === null) continue;
    priced += row.volume;
    if (pct <= 0) atOrBelow += row.volume;
  }
  return { atOrBelow, priced };
}

/* --------------------------------------------------------------- radar */

/** A whitespace placed on the quadrant. Both axes are 0–100 percentages. */
export interface Dot {
  id: string;
  label: string;
  /** Openness of the market: 100 − competition score. */
  fit: number;
  /** The linked cluster's momentum. */
  momentum: number;
  /** Evidence references behind it — the dot's area. */
  evidence: number;
  status: string;
  selected: boolean;
}

export interface EvidenceBlob {
  refs?: string[];
  demandEstimate?: { unit?: string; method?: string; confidence?: string; note?: string };
}

export function evidenceOf(row: WhitespaceRow): EvidenceBlob {
  return asJson<EvidenceBlob>(row.evidenceRefsJson, {});
}

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Only clustered whitespace can be plotted: the vertical axis is the cluster's
 * momentum and there is no second source for it, so an unlinked row would have
 * to be placed at a momentum nobody measured. Those rows are counted instead
 * (see `unplotted`) so the screen never quietly drops one.
 */
export function dots(
  whitespaces: readonly WhitespaceRow[],
  clusters: readonly ClusterRow[],
  selectedId: string | null
): Dot[] {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  return whitespaces.flatMap((row) => {
    const cluster = row.clusterId === null ? undefined : byId.get(row.clusterId);
    if (!cluster || row.competitionScore === null) return [];
    return [
      {
        id: row.id,
        label: cluster.theme,
        fit: clamp(100 - row.competitionScore),
        momentum: clamp(cluster.momentumScore),
        evidence: evidenceOf(row).refs?.length ?? 0,
        status: row.status,
        selected: row.id === selectedId
      }
    ];
  });
}

export function unplotted(whitespaces: readonly WhitespaceRow[], clusters: readonly ClusterRow[]): number {
  const plotted = new Set(dots(whitespaces, clusters, null).map((dot) => dot.id));
  return whitespaces.filter((row) => !plotted.has(row.id)).length;
}

/** Dot diameter in pixels, from the count of evidence references. */
export function dotSize(evidence: number): number {
  return 14 + Math.min(4, evidence) * 6;
}

/* ----------------------------------------------------------- experiments */

export interface Plan {
  channels?: string[];
  dailyCapMinor?: number;
  currency?: string;
  maxDays?: number;
  stopRule?: string;
  bannerKey?: string;
}

export interface Results {
  visits?: number;
  quoteStarts?: number;
  waitlist?: number;
  qualifiedDemandBps?: number;
  verdict?: string;
  note?: string;
  interim?: boolean;
  spentMinor?: number;
  replicationOf?: string;
}

export const planOf = (row: ExperimentRow): Plan => asJson<Plan>(row.trafficPlanJson, {});
export const resultsOf = (row: ExperimentRow): Results => asJson<Results>(row.resultsJson, {});

/** The states `scout:experiments:decide` may move a row to. */
export const DECISIONS = ["running", "concluded", "abandoned"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * The verdict pill. There is no numeric success gate on the row — the plan's
 * `stopRule` is prose — so a running experiment reads as running, never as
 * "on track" or "behind" against a threshold nothing stores.
 * ponytail: add `xp.onTrack` when scout_experiments carries a numeric gate.
 */
export function verdictKey(row: ExperimentRow): { key: string; tone: "success" | "warning" | "neutral" | "danger" } {
  const verdict = resultsOf(row).verdict;
  if (row.state === "abandoned") return { key: "xp.parked", tone: "neutral" };
  if (row.state === "concluded" && verdict === "supported") return { key: "xp.supported", tone: "success" };
  if (row.state === "concluded" && verdict === "did_not_replicate") return { key: "xp.notReplicated", tone: "warning" };
  if (row.state === "concluded") return { key: "xp.concluded", tone: "neutral" };
  if (row.state === "running") return { key: "xp.running", tone: "success" };
  return { key: "xp.draft", tone: "neutral" };
}

/* --------------------------------------------------------------- labels */

export type Label = (key: string, vars?: Record<string, string>) => string;

const LABELS: Record<string, Record<string, string>> = {
  en: {
    /* shared */
    none: "—",
    insurer: "Carrier",
    line: "Line",
    period: "Period",
    volume: "Volume",
    share: "Share",
    winRate: "Win rate",
    priceIndex: "Price index",
    marketIndex: "Market index",
    position: "Position",
    status: "Status",
    owner: "Owner",
    /* scout_whitespaces.status */
    "status.candidate": "Candidate",
    "status.validating": "Validating",
    "status.validated": "Validated",
    "status.promoted": "Promoted",
    "status.parked": "Parked",
    why: "Why",
    evidence: "Evidence",
    method: "Method",
    confidence: "Confidence",
    kFloor: "Thin cuts withheld",
    kFloorWhy:
      "A bench cut below {k} quotes names the one counterparty behind it, so the API withholds it rather than serving it thin.",
    xlsx: "Excel",
    pdf: "PDF",
    csv: "CSV",
    json: "JSON",
    approvalTitle: "Queued for approval",
    approvalBody: "This change needs an approval under policy {policy}. It is queued, not lost.",
    approvalLink: "Open the approvals queue",
    "problem.bad_intent": "That form did not say what it wanted to do.",
    "problem.whitespace_required": "Pick a theme on the radar first.",
    "problem.state_required": "Choose one of the three decisions.",
    "problem.format_required": "Choose a file format.",
    "problem.dataset_required": "Choose what to export.",
    "problem.experiment_required": "That experiment is missing.",
    "problem.transition_required": "A card cannot move there from where it is.",

    /* radar */
    "radar.title": "Radar",
    "radar.lede": "Whitespace read off our own signals, clusters and panel data — nothing bought in.",
    "radar.axisX": "Fit with distribution strength →",
    "radar.axisY": "Vertical axis = demand momentum · dot size = evidence volume · choose a theme for its dossier",
    "radar.pursue": "Pursue",
    "radar.park": "Park",
    "radar.empty": "No clustered whitespace yet. Run a sweep.",
    "radar.unplotted": "{n} unclustered",
    "radar.unplottedWhy":
      "Momentum is the cluster's, so a whitespace with no cluster has no vertical position and is left off the quadrant.",
    "radar.dossier": "Dossier",
    "radar.demand": "Demand estimate",
    "radar.competition": "Competition",
    "radar.momentum": "Momentum 90d",
    "radar.signals": "Cluster size",
    "radar.pick": "Choose a theme to read its dossier.",
    "radar.summaryWhy": "Cluster summary written by the clusterer over {n} signals.",
    "radar.sweep": "Run the whitespace sweep",
    "radar.sweepHint": "Re-reads the last quarter of quotes and rewrites the candidate list.",
    "radar.swept": "{n} candidates written.",
    "radar.experiment": "Spin up an experiment",
    "radar.experimentHint": "Creates a draft experiment against this theme. Nothing goes live until you start it.",
    "radar.created": "Draft experiment created.",
    "radar.openBoard": "Experiment board",
    "radar.openCard": "Open the whitespace card",

    /* whitespace card */
    "wsp.title": "Whitespace card",
    "wsp.lede": "The whole case for one theme: what was observed, what it is estimated to be worth, what has been tried, and every move anyone has made on it.",
    "wsp.missing": "No whitespace with that reference on this board.",
    "wsp.openRadar": "Back to the radar",
    "wsp.case": "The case",
    "wsp.promotedOn": "Promoted",
    "wsp.experiments": "Experiments",
    "wsp.experimentsHint": "Every bounded test run against this theme, newest first.",
    "wsp.noExperiments": "Nothing has been tested against this theme yet.",
    "wsp.flags": "Regulatory flags",
    "wsp.flagsHint":
      "Items the circular feed raised on this cluster and who has to read them. A flag records that an item appeared — never what it requires.",
    "wsp.noFlags": "No regulatory items raised on this cluster.",
    "wsp.decisions": "Decision log",
    "wsp.decisionsHint": "Every write against this card, from the audit log. Append-only.",
    "wsp.noDecisions": "No moves recorded yet.",
    "wsp.decisionsWithheld": "Reading the audit log needs the audit permission.",
    "wsp.move": "Move this card",
    "wsp.moveHint": "Promoting or parking a card is an approved change, so it queues for a second pair of eyes.",
    "wsp.moveDenied": "Moving a card needs the promote permission.",
    "wsp.noMoves": "This card is in a state with nowhere to move.",
    "wsp.target": "Move to",
    "wsp.ownerHint": "Who carries it from here. Leave as-is to keep the current owner.",
    "wsp.moved": "Moved to {status}.",

    /* panel */
    "panel.title": "Panel intelligence",
    "panel.lede": "Where each carrier sits on price and conversion, for {period}.",
    "panel.empty": "No bench rows for this period.",
    "panel.lines": "Lines",
    "panel.gaps": "Wording gaps",
    "panel.cheaper": "Below the median",
    "panel.atMarket": "At the median",
    "panel.dearer": "Above the median",
    "panel.unpriced": "No price to index",
    "panel.pack": "Build the negotiation pack",
    "panel.packHint": "Volume delivered, competitive index and the wording gaps, as a PDF.",
    "panel.packDenied": "The pack quotes counterparty numbers, so it needs the promote permission.",
    "panel.openPricing": "Price benchmarks",

    /* price benchmarks */
    "price.title": "Price benchmarks",
    "price.lede": "Our quoted price against the panel median, by line, for {period}.",
    "price.byLine": "Index against the median",
    "price.losing": "Where we lose",
    "price.note":
      "The index is our quoted price over the median of the panel's own responses to the same request. It is not an industry price survey.",
    "price.above": "{pct}% above",
    "price.below": "{pct}% below",
    "price.empty": "Nothing priced in this period.",
    "price.allBelow": "Every priced cut sits at or below the median.",

    /* experiments */
    "xp.title": "Experiments",
    "xp.lede": "Every promoted whitespace runs as a bounded experiment with a written stop rule.",
    "xp.experiment": "Experiment",
    "xp.since": "Live since",
    "xp.gate": "Stop rule",
    "xp.quotes": "Quote starts",
    "xp.waitlist": "Waitlist",
    "xp.verdict": "Verdict",
    "xp.draft": "Draft",
    "xp.running": "Running",
    "xp.concluded": "Concluded",
    "xp.supported": "Supported",
    "xp.notReplicated": "Did not replicate",
    "xp.parked": "Parked",
    "xp.interim": "Interim read",
    "xp.cap": "{amount} {currency} a day, {days} days at most",
    "xp.noPlan": "No plan recorded",
    "xp.footnote":
      "Parked is not failed — the evidence stays attached so the theme can be re-opened when the market moves.",
    "xp.decide": "Record a decision",
    "xp.decideHint": "Concluding an experiment is a decision about a build, so it is logged against you.",
    "xp.pick": "Experiment",
    "xp.newState": "Decision",
    "xp.decided": "Decision recorded.",
    "xp.empty": "No experiments yet.",
    "xp.openRadar": "Radar",

    /* analytics */
    "an.title": "Pricing analytics",
    "an.lede": "Elasticity, win rate and price adequacy across the whole bench.",
    "an.periods": "Periods on the bench",
    "an.winRate": "Blended win rate",
    "an.adequacy": "Volume at or below the median",
    "an.index": "Blended index",
    "an.pricedVolume": "Priced volume",
    "an.elasticity": "Observed elasticity",
    "an.elasticityHint":
      "Win-rate points moved per percent of price moved, between the last two periods of each cut. Observed, not measured: no experiment moved these prices on purpose.",
    "an.move": "Price move",
    "an.winMove": "Win-rate move",
    "an.ratio": "Points per percent",
    "an.window": "Periods",
    "an.held": "Price held",
    "an.empty": "Fewer than two periods on the bench, so there is nothing to compare.",
    "an.export": "Export",
    "an.exportHint": "Rendered by the platform's own report engine, with its own masking rules.",
    "an.dataset": "Table",
    "an.format": "Format",
    "an.whitespaces": "Whitespace pipeline",
    "an.signals": "Signal volume",
    "an.exportReady": "Ready.",
    "an.exportQueued": "Queued.",
    "an.download": "Download",
    "an.benchNotExportable": "The bench itself is not exportable",
    "an.benchNotExportableWhy":
      "The report engine has no price-bench table registered, so the index and win-rate figures above cannot be rendered as a file. The negotiation pack is the export that carries them.",
    "an.openPanel": "Panel intelligence"
  },
  ar: {
    /* shared */
    none: "—",
    insurer: "شركة التأمين",
    line: "خط الأعمال",
    period: "الفترة",
    volume: "الحجم",
    share: "الحصة",
    winRate: "معدل الفوز",
    priceIndex: "مؤشر السعر",
    marketIndex: "مؤشر السوق",
    position: "الموقع",
    status: "الحالة",
    owner: "المسؤول",
    /* scout_whitespaces.status */
    "status.candidate": "مرشحة",
    "status.validating": "قيد التحقق",
    "status.validated": "مُثبتة",
    "status.promoted": "معتمدة",
    "status.parked": "موقوفة",
    why: "السبب",
    evidence: "الأدلة",
    method: "الطريقة",
    confidence: "درجة الثقة",
    kFloor: "الفئات القليلة محجوبة",
    kFloorWhy: "الفئة التي تقل عن {k} عرض سعر تكشف الطرف الوحيد خلفها، لذا تحجبها الواجهة بدل تقديمها ناقصة.",
    xlsx: "إكسل",
    pdf: "بي دي إف",
    csv: "ملف مفصول بفواصل",
    json: "جيسون",
    approvalTitle: "في انتظار الموافقة",
    approvalBody: "هذا التغيير يحتاج موافقة بموجب سياسة {policy}. هو في الانتظار ولم يُفقد.",
    approvalLink: "افتح قائمة الموافقات",
    "problem.bad_intent": "لم يحدد هذا النموذج ما يريد فعله.",
    "problem.whitespace_required": "اختر فكرة من الرادار أولًا.",
    "problem.state_required": "اختر واحدًا من القرارات الثلاثة.",
    "problem.format_required": "اختر صيغة الملف.",
    "problem.dataset_required": "اختر ما تريد تصديره.",
    "problem.experiment_required": "هذه التجربة غير موجودة.",
    "problem.transition_required": "لا يمكن نقل البطاقة إلى تلك الحالة من حالتها الراهنة.",

    /* radar */
    "radar.title": "الرادار",
    "radar.lede": "فرص غير مخدومة مستخلصة من إشاراتنا وعناقيدنا وبيانات قائمة الجهات المسعّرة — لا شيء مُشترى من الخارج.",
    "radar.axisX": "الملاءمة مع قوة التوزيع ←",
    "radar.axisY": "المحور الرأسي = زخم الطلب · حجم النقطة = كمية الأدلة · اختر فكرة لعرض ملفها",
    "radar.pursue": "تابع",
    "radar.park": "أوقف",
    "radar.empty": "لا توجد فرص معنقدة بعد. شغّل عملية المسح.",
    "radar.unplotted": "{n} بلا عنقود",
    "radar.unplottedWhy": "الزخم يأتي من العنقود، فالفرصة بلا عنقود ليس لها موضع رأسي وتُترك خارج المخطط.",
    "radar.dossier": "الملف",
    "radar.demand": "تقدير الطلب",
    "radar.competition": "المنافسة",
    "radar.momentum": "الزخم ٩٠ يومًا",
    "radar.signals": "حجم العنقود",
    "radar.pick": "اختر فكرة لقراءة ملفها.",
    "radar.summaryWhy": "ملخص العنقود كتبته أداة التجميع العنقودي من {n} إشارة.",
    "radar.sweep": "شغّل مسح الفرص",
    "radar.sweepHint": "يعيد قراءة عروض الربع الأخير ويكتب قائمة المرشحات من جديد.",
    "radar.swept": "تمت كتابة {n} مرشحًا.",
    "radar.experiment": "أنشئ تجربة",
    "radar.experimentHint": "ينشئ تجربة مسودة على هذه الفكرة. لا شيء ينطلق قبل أن تبدأها.",
    "radar.created": "تم إنشاء تجربة مسودة.",
    "radar.openBoard": "لوحة التجارب",
    "radar.openCard": "فتح بطاقة الفرصة",

    /* whitespace card */
    "wsp.title": "بطاقة الفرصة",
    "wsp.lede": "الملف الكامل لفرصة واحدة: ما رُصد، وما تقدير قيمته، وما جُرّب، وكل خطوة اتخذها أحد بشأنه.",
    "wsp.missing": "لا توجد فرصة بهذا المرجع على هذه اللوحة.",
    "wsp.openRadar": "العودة إلى الرادار",
    "wsp.case": "الملف",
    "wsp.promotedOn": "اعتُمدت",
    "wsp.experiments": "التجارب",
    "wsp.experimentsHint": "كل اختبار محدود جرى على هذه الفرصة، الأحدث أولاً.",
    "wsp.noExperiments": "لم يُختبر شيء على هذه الفرصة بعد.",
    "wsp.flags": "تنبيهات تنظيمية",
    "wsp.flagsHint":
      "البنود التي رصدها موجز التعاميم على هذه المجموعة ومَن عليه قراءتها. التنبيه يسجّل ظهور البند فقط، لا ما يقتضيه.",
    "wsp.noFlags": "لا بنود تنظيمية على هذه المجموعة.",
    "wsp.decisions": "سجل القرارات",
    "wsp.decisionsHint": "كل تعديل على هذه البطاقة، من سجل التدقيق. للإضافة فقط.",
    "wsp.noDecisions": "لم تُسجّل أي خطوة بعد.",
    "wsp.decisionsWithheld": "قراءة سجل التدقيق تحتاج صلاحية التدقيق.",
    "wsp.move": "نقل البطاقة",
    "wsp.moveHint": "اعتماد البطاقة أو إيقافها تغيير خاضع للموافقة، لذا ينتظر مراجعة ثانية.",
    "wsp.moveDenied": "نقل البطاقة يحتاج صلاحية الاعتماد.",
    "wsp.noMoves": "هذه البطاقة في حالة لا نقل منها.",
    "wsp.target": "النقل إلى",
    "wsp.ownerHint": "من يتولاها من هنا. اتركه كما هو للإبقاء على المسؤول الحالي.",
    "wsp.moved": "نُقلت إلى {status}.",

    /* panel */
    "panel.title": "معلومات قائمة الجهات المسعّرة",
    "panel.lede": "موقع كل شركة تأمين من حيث السعر والتحويل، لفترة {period}.",
    "panel.empty": "لا توجد صفوف مقارنة لهذه الفترة.",
    "panel.lines": "خطوط الأعمال",
    "panel.gaps": "فروق الصياغة",
    "panel.cheaper": "أقل من الوسيط",
    "panel.atMarket": "عند الوسيط",
    "panel.dearer": "أعلى من الوسيط",
    "panel.unpriced": "لا سعر للمقارنة",
    "panel.pack": "أنشئ ملف التفاوض",
    "panel.packHint": "الحجم المحوّل ومؤشر المنافسة وفروق الصياغة، في ملف بي دي إف.",
    "panel.packDenied": "الملف يذكر أرقام الأطراف الأخرى، لذا يحتاج صلاحية الترقية.",
    "panel.openPricing": "مقاييس السعر",

    /* price benchmarks */
    "price.title": "مقاييس السعر",
    "price.lede": "سعرنا المعروض مقابل وسيط قائمة الجهات المسعّرة، بحسب خط الأعمال، لفترة {period}.",
    "price.byLine": "المؤشر مقابل الوسيط",
    "price.losing": "أين نخسر",
    "price.note": "المؤشر هو سعرنا المعروض مقسومًا على وسيط ردود الجهات المسعّرة على الطلب نفسه. وهو ليس مسحًا لأسعار السوق.",
    "price.above": "{pct}٪ أعلى",
    "price.below": "{pct}٪ أقل",
    "price.empty": "لا شيء مُسعّر في هذه الفترة.",
    "price.allBelow": "كل الفئات المُسعّرة عند الوسيط أو أقل منه.",

    /* experiments */
    "xp.title": "التجارب",
    "xp.lede": "كل فرصة مرقّاة تُدار كتجربة محدودة لها قاعدة توقف مكتوبة.",
    "xp.experiment": "التجربة",
    "xp.since": "تعمل منذ",
    "xp.gate": "قاعدة التوقف",
    "xp.quotes": "بدايات العرض",
    "xp.waitlist": "قائمة الانتظار",
    "xp.verdict": "الحكم",
    "xp.draft": "مسودة",
    "xp.running": "جارية",
    "xp.concluded": "منتهية",
    "xp.supported": "مدعومة",
    "xp.notReplicated": "لم تتكرر",
    "xp.parked": "موقوفة",
    "xp.interim": "قراءة مؤقتة",
    "xp.cap": "{amount} {currency} يوميًا، {days} يومًا كحد أقصى",
    "xp.noPlan": "لا خطة مسجلة",
    "xp.footnote": "الإيقاف ليس فشلًا — تبقى الأدلة مرفقة ليُعاد فتح الفكرة عندما يتغير السوق.",
    "xp.decide": "سجّل قرارًا",
    "xp.decideHint": "إنهاء تجربة هو قرار بشأن بناء منتج، لذا يُسجَّل باسمك.",
    "xp.pick": "التجربة",
    "xp.newState": "القرار",
    "xp.decided": "تم تسجيل القرار.",
    "xp.empty": "لا توجد تجارب بعد.",
    "xp.openRadar": "الرادار",

    /* analytics */
    "an.title": "تحليلات التسعير",
    "an.lede": "المرونة ومعدل الفوز وكفاية السعر على كامل قائمة الجهات المسعّرة.",
    "an.periods": "الفترات على القائمة",
    "an.winRate": "معدل الفوز المدمج",
    "an.adequacy": "الحجم عند الوسيط أو أقل",
    "an.index": "المؤشر المدمج",
    "an.pricedVolume": "الحجم المُسعّر",
    "an.elasticity": "المرونة المرصودة",
    "an.elasticityHint":
      "نقاط معدل الفوز مقابل كل نقطة مئوية من تغير السعر، بين آخر فترتين لكل فئة. مرصودة لا مقيسة: لا تجربة حرّكت هذه الأسعار عن قصد.",
    "an.move": "تغير السعر",
    "an.winMove": "تغير معدل الفوز",
    "an.ratio": "نقاط لكل بالمئة",
    "an.window": "الفترات",
    "an.held": "السعر ثابت",
    "an.empty": "أقل من فترتين على القائمة، فلا شيء للمقارنة.",
    "an.export": "تصدير",
    "an.exportHint": "يُنتجه محرك التقارير في المنصة، بقواعد الحجب الخاصة به.",
    "an.dataset": "الجدول",
    "an.format": "الصيغة",
    "an.whitespaces": "مسار الفرص",
    "an.signals": "حجم الإشارات",
    "an.exportReady": "جاهز.",
    "an.exportQueued": "في الانتظار.",
    "an.download": "تنزيل",
    "an.benchNotExportable": "جدول المقارنة نفسه غير قابل للتصدير",
    "an.benchNotExportableWhy":
      "محرك التقارير لا يسجّل جدول مقارنة الأسعار، لذا لا يمكن إخراج أرقام المؤشر ومعدل الفوز أعلاه كملف. ملف التفاوض هو التصدير الذي يحملها.",
    "an.openPanel": "معلومات قائمة الجهات المسعّرة"
  }
};

/** The catalogue, for the parity test. */
export const LABEL_KEYS = LABELS;

export function labelsIn(locale: string, pack?: string): Label {
  const table = LABELS[locale] ?? LABELS.en!;
  const fallback = LABELS.en!;
  const word = vocabulary(pack, locale);
  return (key, vars) => {
    const text = pseudoText(locale, word(key) ?? table[key] ?? fallback[key] ?? key);
    return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : text;
  };
}

/** A refusal in the reader's language when we have words for that code. */
export function explain(problem: Problemish, l: Label): Problemish {
  const key = problem.code ? `problem.${problem.code}` : "";
  return key && LABELS.en![key] ? { ...problem, title: l(key) } : problem;
}

/** Every action below answers in this shape, so one `<Gate>` covers all five. */
export interface Refusal {
  problem: Problemish;
  done: null;
}

export function refuse(code: string, status = 400): Refusal {
  return { problem: { title: code, status, code }, done: null };
}
