/**
 * Screen contract — imported from the Lyra Constellation design file
 * (docs/superpowers/specs/2026-08-16-revenue-lines-full-build-design.md's
 * design-project pull). Every screen the design file ships is DATA against a
 * fixed vocabulary, never a bespoke per-screen component.
 *
 * Shapes below are transcribed LITERALLY from the design file's own
 * `Component.surfaces()` output (executed, not hand-copied — see the
 * extraction harness this package's build notes reference), not invented.
 * Two divergences from a "clean" design are kept on purpose because the real
 * data has them:
 *
 *   - Money/date-like fields arrive as ALREADY-FORMATTED display strings
 *     (`"AED 46,200.00"`, `"06 Aug 2026"`), not `amountMinor`+`currency` or a
 *     real `Instant`. They render as literal text, which still satisfies
 *     "money always names its currency" because the string already does.
 *   - Colour fields (`hue`, `bg`, `line`, `vhue`, ...) are literal
 *     `var(--x)` CSS custom-property strings from the design file's own
 *     token names (`--ok`, `--bad`, `--axis`, ...). packages/ui/src/tokens.css
 *     now aliases every one of those onto Constellation's existing semantic
 *     tokens (additive, docs/07) so they resolve as-is — components apply
 *     them via inline `style`, they are not re-mapped per item.
 *
 * The design file's own `surfaces()` emits three top-level screen kinds, not
 * one: `"surface"` (the 22-section dashboard contract below), `"list"` (a
 * plain filtered table + freeform notes — apps/web already has `Table`/
 * `EmptyState` for this shape) and one single `"mobile"` gallery screen. All
 * three are covered so `surfaceFor` never has to drop or invent data for the
 * ~45% of screens that are not dashboards.
 */

/* -------------------------------------------------------------------------- */
/* Section kinds                                                              */
/* -------------------------------------------------------------------------- */

export type SectionKind =
  | "kpi"
  | "stat"
  | "pair"
  | "steps"
  | "timeline"
  | "rows"
  | "bars"
  | "bands"
  | "spark"
  | "radar"
  | "flow"
  | "board"
  | "kv"
  | "chat"
  | "ghost"
  | "callout"
  | "notes"
  | "form"
  | "quotes"
  | "frame"
  | "text"
  | "empty";

/** Shared by every section: a kind tag and an optional heading. Sections
 * often set `title: ""` rather than omit it, so it stays a required string. */
interface SectionBase<K extends SectionKind> {
  kind: K;
  title: string;
}

/** `half()` in the design file — a section that takes half a row instead of
 * the full width. Present on the section kinds observed carrying it. */
interface HalfWidth {
  flex?: string;
  min?: string;
}

/* ---- kpi -------------------------------------------------------------- */

export interface KpiItem {
  label: string;
  value: string;
  note: string;
  vhue: string;
  bg: string;
  hasDelta: boolean;
  delta: string;
  dhue: string;
  dbg: string;
  dline: string;
  hasSpark: boolean;
  spark: number[];
}

export interface KpiSectionData extends SectionBase<"kpi"> {
  items: KpiItem[];
}

/* ---- stat --------------------------------------------------------------- */

export interface StatItem {
  label: string;
  value: string;
  note: string;
  state: string;
  hue: string;
  vhue: string;
  bg: string;
  line: string;
}

export interface StatSectionData extends SectionBase<"stat"> {
  items: StatItem[];
}

/* ---- pair ----------------------------------------------------------------- */

export interface PairPoint {
  body: string;
}

export interface PairItem {
  label: string;
  hue: string;
  bg: string;
  line: string;
  star: boolean;
  lede: string;
  points: PairPoint[];
}

export interface PairSectionData extends SectionBase<"pair">, HalfWidth {
  items: PairItem[];
}

/* ---- steps ---------------------------------------------------------------- */

export interface StepsItem {
  code: string;
  dot: string;
  title: string;
  money: string;
  note: string;
  hue: string;
}

export interface StepsSectionData extends SectionBase<"steps"> {
  items: StepsItem[];
}

/* ---- timeline --------------------------------------------------------------- */

export interface TimelineItem {
  /** A display string ("06:02"), not a real instant — see file header. */
  when: string;
  hue: string;
  title: string;
  note: string;
  value: string;
}

export interface TimelineSectionData extends SectionBase<"timeline">, HalfWidth {
  items: TimelineItem[];
}

/* ---- rows ------------------------------------------------------------------- */

export interface RowsCell {
  v: string;
  badge: boolean;
  plain: boolean;
  align: "left" | "right";
  font: string;
  size: string;
  hue: string;
  bg: string;
  line: string;
}

export interface RowsRow {
  cells: RowsCell[];
}

export interface RowsHeader {
  label: string;
  align: "left" | "right";
}

export interface RowsSectionData extends SectionBase<"rows">, HalfWidth {
  items: RowsRow[];
  grid?: string;
  headers?: RowsHeader[];
  sub?: string;
}

/* ---- bars ----------------------------------------------------------------- */

export interface BarsItem {
  label: string;
  value: string;
  w: string;
  hue: string;
  note: string;
}

export interface BarsSectionData extends SectionBase<"bars">, HalfWidth {
  items: BarsItem[];
}

/* ---- bands ------------------------------------------------------------------ */

export interface BandsItem {
  label: string;
  value: string;
  hue: string;
  bandL: string;
  bandW: string;
  midL: string;
  note: string;
}

export interface BandsSectionData extends SectionBase<"bands">, HalfWidth {
  items: BandsItem[];
  sub?: string;
}

/* ---- spark ------------------------------------------------------------------ */

export interface SparkItem {
  h: string;
  hue: string;
  label: number;
}

export interface SparkSectionData extends SectionBase<"spark">, HalfWidth {
  items: SparkItem[];
  from?: string;
  mid?: string;
  to?: string;
}

/* ---- radar ------------------------------------------------------------------- */

export interface RadarItem {
  label: string;
  x: string;
  y: string;
  size: string;
  trail: string;
  hue: string;
}

export interface RadarSectionData extends SectionBase<"radar"> {
  items: RadarItem[];
  xlab?: string;
  ylab?: string;
}

/* ---- flow --------------------------------------------------------------- */

export interface FlowItem {
  from: string;
  to: string;
  /** A pre-formatted money string. */
  value: string;
  /** A pixel width string, e.g. "18px" — drives the connector's thickness. */
  weight: string;
  hue: string;
}

export interface FlowSectionData extends SectionBase<"flow"> {
  items: FlowItem[];
  sub?: string;
}

/* ---- board ------------------------------------------------------------------ */

export interface BoardCard {
  title: string;
  clock: string;
  note: string;
  who: string;
  value: string;
  /** Marks a card the ✦ agent produced — never render without the AGENT_MARK. */
  ai: boolean;
  line: string;
}

export interface BoardColumn {
  name: string;
  hue: string;
  count: string;
  cards: BoardCard[];
}

export interface BoardSectionData extends SectionBase<"board"> {
  items: BoardColumn[];
}

/* ---- kv --------------------------------------------------------------- */

export interface KvItem {
  label: string;
  value: string;
  hue: string;
  font: string;
}

export interface KvSectionData extends SectionBase<"kv">, HalfWidth {
  items: KvItem[];
}

/* ---- chat -------------------------------------------------------------- */

export interface ChatItem {
  align: "flex-start" | "flex-end";
  who: string;
  stamp: string;
  delivery: string;
  dhue: string;
  hue: string;
  bg: string;
  line: string;
  body: string;
}

export interface ChatSectionData extends SectionBase<"chat"> {
  items: ChatItem[];
}

/* ---- ghost -------------------------------------------------------------- */

export interface GhostChip {
  label: string;
  bg: string;
  tx: string;
  line: string;
}

export interface GhostSectionData extends SectionBase<"ghost">, HalfWidth {
  items: GhostChip[];
  agent: string;
  why: string;
  conf: string;
  confHue: string;
  confLabel: string;
  draft: string;
  foot: string;
}

/* ---- callout ------------------------------------------------------------------ */

export interface CalloutItem {
  code: string;
  hue: string;
  body: string;
}

export interface CalloutSectionData extends SectionBase<"callout">, HalfWidth {
  items: CalloutItem[];
  /** The single-callout form sets these directly instead of using `items`. */
  label?: string;
  body?: string;
  hue?: string;
  bg?: string;
  line?: string;
}

/* ---- notes ------------------------------------------------------------------ */

export interface NotesItem {
  hue: string;
  label: string;
  body: string;
}

export interface NotesSectionData extends SectionBase<"notes">, HalfWidth {
  items: NotesItem[];
}

/* ---- form -------------------------------------------------------------- */

export interface FormItem {
  label: string;
  value: string;
  /** The field's control type, e.g. "date" — overloads `kind` at item level. */
  kind: string;
  w: string;
  hint: string;
  req: string;
  reqHue: string;
  font: string;
  vhue: string;
  bg: string;
  line: string;
}

export interface FormSectionData extends SectionBase<"form">, HalfWidth {
  items: FormItem[];
}

/* ---- quotes -------------------------------------------------------------- */

export interface QuoteTag {
  label: string;
  hue: string;
  bg: string;
  line: string;
}

export interface QuoteItem {
  insurer: string;
  plan: string;
  price: string;
  pnote: string;
  phue: string;
  tags: QuoteTag[];
  cta: string;
  ctaBg: string;
  ctaTx: string;
  ctaLine: string;
  bg: string;
  line: string;
}

export interface QuotesSectionData extends SectionBase<"quotes"> {
  items: QuoteItem[];
}

/* ---- frame -------------------------------------------------------------- */

export interface FrameSectionData extends SectionBase<"frame"> {
  items: never[];
  url: string;
  gate: string;
}

/* ---- text -------------------------------------------------------------- */

export interface TextItem {
  body: string;
}

export interface TextSectionData extends SectionBase<"text"> {
  items: TextItem[];
  lede?: string;
}

/* ---- empty -------------------------------------------------------------- */

export interface EmptySectionData extends SectionBase<"empty">, HalfWidth {
  items: never[];
  label: string;
  body: string;
  action: string;
}

/* -------------------------------------------------------------------------- */
/* Section union                                                              */
/* -------------------------------------------------------------------------- */

export type Section =
  | KpiSectionData
  | StatSectionData
  | PairSectionData
  | StepsSectionData
  | TimelineSectionData
  | RowsSectionData
  | BarsSectionData
  | BandsSectionData
  | SparkSectionData
  | RadarSectionData
  | FlowSectionData
  | BoardSectionData
  | KvSectionData
  | ChatSectionData
  | GhostSectionData
  | CalloutSectionData
  | NotesSectionData
  | FormSectionData
  | QuotesSectionData
  | FrameSectionData
  | TextSectionData
  | EmptySectionData;

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Data for the one interactive hero every screen renders above `sections[]`
 * (not part of the design file — see packages/ui/src/sections/hero.tsx). Kept
 * optional and generic on purpose: a screen with no natural headline figure
 * still renders (Hero degrades to just the eyebrow/title), never a crash.
 */
export interface HeroChip {
  label: string;
  value: string;
  /** Revealed on hover/focus — the "amazing interactive" part of a KPI chip. */
  detail?: string;
  hue?: string;
}

export interface HeroData {
  /** A scrubbable spark/timeline strip. Reuses `SparkItem`'s literal shape
   * when a screen's own `spark` section doubles as the hero's figure. */
  trend?: SparkItem[];
  chips?: HeroChip[];
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/** Module/group id as the design file (and apps/web/app/modules) use it. */
export type ScreenModule =
  | "axis"
  | "orbit"
  | "signal"
  | "scout"
  | "north"
  | "ledger"
  | "distribution"
  | "compliance"
  | "admin"
  | "portals"
  | "mobile"
  | "system"
  | "hub";

interface ScreenBase {
  id: string;
  mod: ScreenModule;
  group: string;
  nav: string;
  flag: string;
  eyebrow: string;
  title: string;
  attn: string;
  sub: string;
  /** Prose description of what the screen draws from — NOT an API resource
   * path (docs/superpowers's design pull has no route-keyed `source`). See
   * apps/web/app/routes/surface.tsx for how the loader treats it. */
  source: string;
  /** The single interactive hero this build adds on top of the design file. */
  hero?: HeroData;
}

/** The 22-section dashboard contract (`kind: "surface"` in the source data). */
export interface SurfaceScreen extends ScreenBase {
  kind: "surface";
  sections: Section[];
}

/** A filtered table + freeform notes screen (`kind: "list"`). */
export interface ListScreen extends ScreenBase {
  kind: "list";
  /** `[label, columnType]` pairs — columnType drives alignment/mono the same
   * way the design file's own `cell()` does (money/num/badge right-align). */
  cols: [string, string][];
  /** `[filterKey, defaultValue]` pairs. */
  filters: [string, string][];
  rows: string[][];
  /** `[hue, label, body]` triples. */
  notes: [string, string, string][];
}

export interface PhoneCard {
  tag: string;
  stamp: string;
  head: string;
  body: string;
  hue: string;
  bg: string;
  line: string;
}

export interface PhoneTab {
  label: string;
  hue: string;
}

export interface PhoneMock {
  time: string;
  net: string;
  eyebrow: string;
  title: string;
  cards: PhoneCard[];
  tabs: PhoneTab[];
  caption: string;
}

/** The one phone-gallery screen (`kind: "mobile"`, id `out-mobile`). */
export interface MobileScreen extends ScreenBase {
  kind: "mobile";
  phones: PhoneMock[];
}

export type Screen = SurfaceScreen | ListScreen | MobileScreen;
