import { AGENT_MARK, Badge, DateTime, EvidenceLink, Ref, type BadgeTone } from "@lyra/ui";
import { pseudoText } from "../i18n";
import { labelsIn, type Label } from "../routes/scout.shared";

// The reader's own words about one whitespace, rendered two ways: a ghost card
// that appears under the pointer or the keyboard on the radar, and a quiet chip
// with an inspectable "why" in the dossier (docs/15 §4 patterns 2 and 7).
//
// Two rules shape the whole file. First, the commentary is read by the loader
// with the rest of the screen, so neither rendering ever fetches anything — a
// hover costs nothing and cannot spin. Second, a hover is not a way to publish
// information (WCAG 2.2 AA): the ghost card is always in the DOM and always in
// the accessibility tree, referenced by the dot's `aria-describedby`, and the
// hover only changes its opacity. Nothing waits on a transition, because the
// e2e suite runs with prefers-reduced-motion forced.

/**
 * The evidence one commentary was grounded against. Mirrors `WhitespaceEvidence`
 * in packages/model-gateway/src/whitespace-brief.ts, which is also what the
 * prompt saw — so the hover cannot show a number the sentence was not built on.
 */
export interface WhitespaceEvidence {
  /** The product line the candidate was flagged on — `core_products.line`. */
  category: string;
  /** 0–100 demand momentum. */
  momentum: number;
  /**
   * A live COUNT of the tenant's own active contracts on this line. Not a
   * percentage, and not a gap: an earlier draft of this file called it
   * `coverageGap`, labelled it "Uncovered" and printed it with a % sign. It was
   * never any of those things — 34 contracts on the book rendered as "34%
   * uncovered", which is a number the reader would have acted on.
   */
  coverage: number;
  /** 0–100 panel breadth, null when the panel quoted nothing in the window. */
  competitionScore: number | null;
  /** How many demand signals back the candidate. */
  signalCount: number;
}

/**
 * One row of the commentary read — the shape the API actually returns, see
 * `WhitespaceCommentary` in apps/api/src/engines/scout-whitespace.ts. This file
 * previously described a contract nobody served (a `stance`, a `note`, a
 * `confidence`, a list of `lines`); every field of it read `undefined` against
 * the real endpoint, and only the test doubles kept it looking alive.
 */
export interface WhitespaceCommentary {
  whitespaceId: string;
  category: string | null;
  /** candidate | validating | validated | parked — a text column, read as written. */
  status: string;
  /** The sentence itself, or null when the row is suppressed. */
  commentary: string | null;
  /** Non-null exactly when `commentary` is. */
  evidence: WhitespaceEvidence | null;
  /**
   * The inspectable "why" (docs/15 §4): the exact lines the sentence was
   * grounded against, already written by the server. Rendered verbatim rather
   * than rebuilt from `evidence` here — a second rendering of the same facts is
   * a second chance to word them differently from what the model was shown.
   */
  why: string[];
  /** Null when the sentence is the deterministic fallback — no ✦ in that case. */
  ai: {
    marker: string;
    auditId: string;
    model: string;
    provider: string;
    tier: string;
    at: number;
  } | null;
  /** True when k-anonymity hides the detail. Then commentary/evidence are null. */
  suppressed: boolean;
}

/** A status nobody defined is shown neutrally rather than recoloured into one. */
export function statusOf(status: string): { key: string; tone: BadgeTone } {
  if (status === "validated") return { key: "wc.status.validated", tone: "success" };
  if (status === "validating") return { key: "wc.status.validating", tone: "warning" };
  if (status === "candidate") return { key: "wc.status.candidate", tone: "info" };
  if (status === "parked") return { key: "wc.status.parked", tone: "neutral" };
  return { key: "wc.status.unknown", tone: "neutral" };
}

/**
 * A row with nothing readable on it: either below the k-anonymity floor, or a
 * row the sweep has not described yet. Both render as "no reading", never as an
 * empty card that looks like a reading of nothing.
 */
export function unreadable(commentary: WhitespaceCommentary | null): boolean {
  return commentary === null || commentary.suppressed || commentary.commentary === null;
}

/* ----------------------------------------------------------------- labels */

export const WS_LABELS: Record<string, Record<string, string>> = {
  en: {
    "wc.commentary": "Commentary",
    "wc.commentaryWhy":
      "These are the exact lines the sentence was written from — the same ones the model was shown, not a second summary of them. Nothing here is recomputed to display it.",
    "wc.empty": "No reading on this one yet.",
    "wc.suppressed":
      "Too few signals behind this cell to say anything about it without describing the people in it.",
    "wc.momentum": "Demand momentum",
    "wc.coverage": "On the book",
    "wc.competition": "Competition",
    "wc.notMeasured": "Not measured",
    "wc.signalsRead": "Signals read",
    "wc.readAt": "Written",
    "wc.model": "Model",
    "wc.status.candidate": "Candidate",
    "wc.status.validating": "Being checked",
    "wc.status.validated": "Checked",
    "wc.status.parked": "Parked",
    "wc.status.unknown": "Status not read",
    "wc.convert": "Hand this to the campaign studio",
    "wc.convertHint":
      "Drafts a campaign and its content from this reading. It needs an approval first, and it sends nothing.",
    "wc.convertDenied": "Handing a theme over needs the {perm} grant. Ask an administrator for it, not for a one-off.",
    "wc.drafts": "Background drafts",
    "wc.drafted": "Handed over. {n} drafts written, none sent.",
    "wc.draftedNone": "Handed over. Nothing drafted yet.",
    "wc.queued": "Queued for approval. Nothing has been drafted and nothing sent.",
    "wc.inspect": "Read the drafts"
  },
  ar: {
    "wc.commentary": "تعليق",
    "wc.commentaryWhy":
      "هذه هي السطور التي كُتبت منها الجملة بالضبط — ذاتها التي عُرضت على النموذج، لا تلخيصًا ثانيًا لها. ولا يُحسب شيء هنا من جديد لعرضه.",
    "wc.empty": "لا قراءة لهذه الخانة بعد.",
    "wc.suppressed": "الإشارات خلف هذه الخانة أقل من أن يُقال عنها شيء دون وصف من فيها.",
    "wc.momentum": "زخم الطلب",
    "wc.coverage": "في المحفظة",
    "wc.competition": "المنافسة",
    "wc.notMeasured": "غير مقيس",
    "wc.signalsRead": "الإشارات المقروءة",
    "wc.readAt": "كُتبت",
    "wc.model": "النموذج",
    "wc.status.candidate": "مرشّحة",
    "wc.status.validating": "قيد التحقق",
    "wc.status.validated": "تم التحقق",
    "wc.status.parked": "مؤجّلة",
    "wc.status.unknown": "الحالة غير مقروءة",
    "wc.convert": "أحِل هذه الفكرة إلى استوديو الحملات",
    "wc.convertHint": "يصوغ حملة ومحتواها من هذه القراءة. يحتاج موافقة أولًا، ولا يُرسل شيئًا.",
    "wc.convertDenied": "إحالة فكرة تحتاج صلاحية {perm}. اطلبها من المسؤول بدلًا من استثناء لمرة واحدة.",
    "wc.drafts": "مسودات في الخلفية",
    "wc.drafted": "تمت الإحالة. كُتبت {n} مسودات ولم يُرسل شيء.",
    "wc.draftedNone": "تمت الإحالة. لا مسودات بعد.",
    "wc.queued": "في انتظار الموافقة. لم تُكتب مسودة ولم يُرسل شيء.",
    "wc.inspect": "اقرأ المسودات"
  }
};

/**
 * SCOUT's labeller plus this feature's own keys.
 *
 * ponytail: these belong in routes/scout.shared.ts's table beside the rest of
 * the module's copy, and should be folded in once this branch lands — they are
 * separate only because that file is being edited in parallel.
 */
export function commentaryLabels(locale: string, pack?: string): Label {
  const shared = labelsIn(locale, pack);
  const table = WS_LABELS[locale] ?? WS_LABELS.en!;
  return (key, vars) => {
    const own = table[key] ?? WS_LABELS.en![key];
    if (own === undefined) return shared(key, vars);
    const text = pseudoText(locale, own);
    return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : text;
  };
}

/* ------------------------------------------------------------- renderings */

interface Rendered {
  commentary: WhitespaceCommentary | null;
  l: Label;
  locale: string;
}

/**
 * The radar's hover reveal. Positioned above its dot by the `group` wrapper the
 * dot lives in, so hover and keyboard focus reveal the same card, and inert to
 * the pointer so it never shadows the dots behind it.
 */
export function CommentaryGhost({
  id,
  commentary,
  l,
  locale,
  side = "above"
}: Rendered & { id: string; side?: "above" | "below" }) {
  // A suppressed row still renders — silently dropping the card would leave the
  // dot's aria-describedby pointing at nothing, and would read as "we have no
  // opinion" rather than "we will not describe this few people".
  if (commentary === null) return null;
  const status = statusOf(commentary.status);
  return (
    <div
      id={id}
      // -7rem is half of w-56, which centres the card over the zero-width dot
      // in both writing directions where a -translate-x-1/2 would not.
      style={{ marginInlineStart: "-7rem" }}
      className={`pointer-events-none absolute z-10 flex w-56 flex-col gap-1 rounded-md border border-line bg-surface-2 p-2 text-start opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none ${
        // A dot high in the pursue quadrant has no room above it inside the
        // chart, so its card drops below instead of being clipped off the top.
        side === "above" ? "bottom-full mb-2" : "top-full mt-2"
      }`}
    >
      <p className="font-ui text-12 leading-snug text-text">
        {/* The ✦ is a claim that a model wrote this. A fallback sentence is
            assembled from the two figures by fallbackDescription() and carries
            no `ai`, so marking it would be the one thing docs/15 forbids. */}
        {commentary.ai === null ? null : (
          <span aria-hidden="true" className="me-1 text-accent">
            {AGENT_MARK}
          </span>
        )}
        {commentary.commentary ?? l("wc.suppressed")}
      </p>
      {commentary.evidence === null ? null : (
        <p className="font-ui text-12 text-subtle">{factLine(commentary.evidence, l, locale)}</p>
      )}
      <p className="font-ui text-12 text-subtle">{l(status.key)}</p>
    </div>
  );
}

/** The dossier's quiet chip: the same reading, with the evidence inspectable. */
export function CommentaryChip({ commentary, l, locale }: Rendered) {
  if (commentary === null) return <p className="font-ui text-12 text-subtle">{l("wc.empty")}</p>;
  const status = statusOf(commentary.status);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone} size="sm">
          {l(status.key)}
        </Badge>
        {/* Nothing to inspect on a suppressed row: `why` is empty by
            construction, so an evidence link would open on an empty list. */}
        {commentary.why.length === 0 ? (
          <span className="font-ui text-12">{l("wc.commentary")}</span>
        ) : (
          <EvidenceLink source={<Why commentary={commentary} l={l} locale={locale} />} sourceLabel={l("why")}>
            <span className="font-ui text-12">{l("wc.commentary")}</span>
          </EvidenceLink>
        )}
      </div>
      <p className="font-ui text-13 leading-relaxed text-muted">
        {commentary.ai === null ? null : (
          <span aria-hidden="true" className="me-1 text-accent">
            {AGENT_MARK}
          </span>
        )}
        {commentary.commentary ?? l("wc.suppressed")}
      </p>
    </div>
  );
}

/**
 * The grounding lines as the server wrote them, plus the provenance of the run
 * that wrote the sentence. `why` is not re-worded here: it is the pool the
 * sentence was scored against by `verifyGroundedness`, so a paraphrase would
 * let the panel and the check disagree about what was claimed.
 *
 * They are untranslated on purpose — the server builds them in the tenant's own
 * domain-pack vocabulary at write time, and translating them in the browser
 * would produce a "why" that no longer matches the sentence it explains.
 */
function Why({ commentary, l, locale }: Rendered & { commentary: WhitespaceCommentary }) {
  return (
    <div className="flex max-w-xs flex-col gap-2">
      <ul className="flex list-none flex-col gap-1 font-ui text-12 text-muted">
        {commentary.why.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {commentary.ai === null ? null : (
        <dl className="flex flex-col gap-1 font-ui text-12">
          <div className="flex flex-wrap gap-2">
            <dt className="text-subtle">{l("evidence")}</dt>
            <dd className="font-mono text-muted">
              <Ref value={commentary.ai.auditId} />
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-subtle">{l("wc.model")}</dt>
            <dd className="text-muted">{`${commentary.ai.provider} · ${commentary.ai.model}`}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-subtle">{l("wc.readAt")}</dt>
            <dd className="text-muted">
              <DateTime value={commentary.ai.at} locale={locale} />
            </dd>
          </div>
        </dl>
      )}
      <p className="font-ui text-12 leading-relaxed text-subtle">{l("wc.commentaryWhy")}</p>
    </div>
  );
}

/**
 * The evidence, on one line, for the card that has no room for a list.
 * `coverage` is a count of contracts on the book, so it is printed as a count.
 */
export function factLine(evidence: WhitespaceEvidence, l: Label, locale: string): string {
  return [
    `${l("wc.momentum")} ${num(evidence.momentum, locale)}`,
    `${l("wc.coverage")} ${num(evidence.coverage, locale)}`,
    `${l("wc.competition")} ${
      evidence.competitionScore === null ? l("wc.notMeasured") : num(evidence.competitionScore, locale)
    }`,
    `${l("wc.signalsRead")} ${num(evidence.signalCount, locale)}`
  ].join(" · ");
}

const num = (value: number, locale: string): string => value.toLocaleString(locale);
