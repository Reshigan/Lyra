import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  GuardrailNotice,
  Input,
  Money,
  Ref,
  Select,
  shortRef,
  type BadgeTone
} from "@lyra/ui";
import { ApiError, api } from "../api.server";
import { cloudflare } from "../context";
import { pseudoText } from "../i18n";
import { Gate } from "./staff";
import { useShellData } from "./workspace";

// Where the work is, laid out as the pipeline it actually is. The cases tab can
// sort and filter but it cannot answer "is anything piling up before approval",
// which is the only question a production board exists to answer.
//
// Deliberately NOT a drag-and-drop board. A case's status is workflow state, and
// this API exposes no transition endpoint for it — only the generic
// `PATCH /v1/axis/cases/:id`, which would let a column header choose its own
// state with no state machine, no guard and no approval (CLAUDE.md §12). So the
// board moves nothing: it shows the pile-ups, and a card opens the record where
// the audited edit lives. When `POST /v1/axis/cases/:id/transition` exists, the
// per-column move buttons belong here and nowhere else.

/* --------------------------------------------------------------- contract */

export const PERM = {
  read: "axis:cases:read",
  write: "axis:cases:update"
} as const;

/**
 * Pipeline order, left to right — the order docs/03 §AXIS gives the status
 * column, not alphabetical. `cancelled` is off the board: a cancelled case is
 * not work in progress and a column of them would grow forever.
 */
export const LANES = [
  "intake",
  "quoting",
  "awaiting_docs",
  "review",
  "approval",
  "issued",
  "failed"
] as const;

export type Lane = (typeof LANES)[number];

/**
 * Cards fetched for the whole board. `MAX_PAGE` in apps/api/src/crud.ts is 200,
 * so this is one page: enough to see a pile-up, and the lane counts below carry
 * the true depth for anything past it.
 */
const BOARD_PAGE = 200;

/**
 * Above this many open cards a lane is congested. Not a tenant setting yet.
 * ponytail: one global number, move it to tenant policy when a tenant disagrees.
 */
export const WIP_WARN = 12;

/* ----------------------------------------------------------------- labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Production board",
    intro:
      "Every open case in pipeline order. A lane that turns amber is holding more work than it should. Open a card to act on it — this board reports, it does not move work.",
    "lane.intake": "Intake",
    "lane.quoting": "Quoting",
    "lane.awaiting_docs": "Awaiting documents",
    "lane.review": "Review",
    "lane.approval": "Approval",
    "lane.issued": "Issued",
    "lane.failed": "Failed",
    "wip.count": "{open} open",
    "wip.congested": "Holding {open}, above the {limit} this lane should carry",
    overflow: "and {more} more",
    unassigned: "Nobody",
    "sev.breach": "Overdue",
    "sev.due": "Due soon",
    "sev.urgent": "Urgent",
    "readonly.title": "Cards do not move from here",
    "readonly.reason":
      "A case's status is workflow state, and changing it is an audited edit on the case itself. This board shows where work is sitting; the case record is where it moves.",
    "readonly.action": "Open the case list",
    "empty.title": "The board is empty",
    "empty.body": "No open case is in any pipeline lane right now.",
    "assign.title": "Assign a case",
    "assign.intro": "Ownership is not workflow state, so it can be set from here.",
    "assign.case": "Case",
    "assign.owner": "Owner reference",
    "assign.submit": "Assign",
    "done.assign": "Ownership updated.",
    approvalTitle: "Waiting on an approval",
    approvalBody:
      "This change is gated by {policy}. The request is recorded and takes effect once someone else approves it.",
    approvalLink: "Open approvals",
    "problem.bad_intent": "The form did not carry an action this screen knows.",
    "problem.missing_owner": "Name both the case and the owner before assigning it."
  },
  ar: {
    title: "لوحة الإنتاج",
    intro:
      "كل حالة مفتوحة بترتيب مسار العمل. المسار الذي يتحول إلى الكهرماني يحمل عملًا أكثر مما ينبغي. افتح البطاقة للتعامل معها — هذه اللوحة تُبلّغ ولا تنقل العمل.",
    "lane.intake": "الاستلام",
    "lane.quoting": "التسعير",
    "lane.awaiting_docs": "بانتظار المستندات",
    "lane.review": "المراجعة",
    "lane.approval": "الموافقة",
    "lane.issued": "أُصدرت",
    "lane.failed": "فشلت",
    "wip.count": "{open} مفتوحة",
    "wip.congested": "يحمل {open}، أكثر من {limit} المسموح لهذا المسار",
    overflow: "و{more} غيرها",
    unassigned: "بلا مسؤول",
    "sev.breach": "متأخرة",
    "sev.due": "قريبة الاستحقاق",
    "sev.urgent": "عاجلة",
    "readonly.title": "البطاقات لا تُنقل من هنا",
    "readonly.reason":
      "وضع الحالة هو حالة مسار عمل، وتغييره تعديل مُدقَّق على الحالة نفسها. هذه اللوحة تُظهر مكان تجمّع العمل، وسجل الحالة هو مكان تحريكه.",
    "readonly.action": "فتح قائمة الحالات",
    "empty.title": "اللوحة فارغة",
    "empty.body": "لا توجد حالة مفتوحة في أي مسار الآن.",
    "assign.title": "تعيين حالة",
    "assign.intro": "المسؤولية ليست حالة مسار عمل، لذا يمكن تحديدها من هنا.",
    "assign.case": "الحالة",
    "assign.owner": "مرجع المسؤول",
    "assign.submit": "تعيين",
    "done.assign": "تم تحديث المسؤول.",
    approvalTitle: "بانتظار موافقة",
    approvalBody: "هذا التغيير يمر بسياسة {policy}. سُجّل الطلب ويسري بعد موافقة شخص آخر.",
    approvalLink: "فتح الموافقات",
    "problem.bad_intent": "لم يحمل النموذج إجراءً تعرفه هذه الشاشة.",
    "problem.missing_owner": "حدّد الحالة والمسؤول قبل التعيين."
  }
};

export type Label = (key: string, vars?: Record<string, string>) => string;

export function labelsIn(locale: string): Label {
  return (key, vars) => {
    const raw = pseudoText(locale, LABELS[locale]?.[key] ?? LABELS["en"]?.[key] ?? key);
    return vars ? raw.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : raw;
  };
}

/* ----------------------------------------------------------------- shapes */

export interface BoardCase {
  id: string;
  ref: string;
  kind: string;
  status: string;
  priority: string;
  ownerRef: string | null;
  valueMinor: number | null;
  currency: string | null;
  slaDueAt: number | null;
  createdAt: number;
}

export interface LaneView {
  lane: Lane;
  /** Every card the API returned for this lane, in the order it should be worked. */
  cards: BoardCase[];
  /** The lane's true depth, which can exceed `cards.length`. */
  open: number;
  congested: boolean;
}

/* ---------------------------------------------------------------- helpers */

/**
 * Split one flat page of cases into lanes, worst-first inside each. `counts`
 * carries the API's own totals so a lane that overflowed the page still shows
 * its real depth instead of the truncated one.
 */
export function laneViews(
  cases: BoardCase[],
  now: number,
  counts: Partial<Record<Lane, number>> = {},
  warnAt = WIP_WARN
): LaneView[] {
  return LANES.map((lane) => {
    const cards = cases.filter((row) => row.status === lane).sort(byUrgency(now));
    const open = counts[lane] ?? cards.length;
    return { lane, cards, open, congested: open > warnAt };
  });
}

/** Overdue first, then the earliest deadline, then oldest — the order to work a lane in. */
export function byUrgency(now: number) {
  return (a: BoardCase, b: BoardCase): number => {
    const late = Number(isLate(b, now)) - Number(isLate(a, now));
    if (late !== 0) return late;
    const due = (a.slaDueAt ?? Number.MAX_SAFE_INTEGER) - (b.slaDueAt ?? Number.MAX_SAFE_INTEGER);
    return due !== 0 ? due : a.createdAt - b.createdAt;
  };
}

export const isLate = (row: { slaDueAt?: number | null }, now: number): boolean =>
  typeof row.slaDueAt === "number" && row.slaDueAt < now;

/** What to shout about one card, or nothing. Overdue outranks the priority flag. */
export function flagOf(
  row: BoardCase,
  now: number,
  soonMs = 24 * 60 * 60 * 1000
): { key: string; tone: BadgeTone } | null {
  if (isLate(row, now)) return { key: "sev.breach", tone: "danger" };
  if (row.priority === "urgent") return { key: "sev.urgent", tone: "warning" };
  if (typeof row.slaDueAt === "number" && row.slaDueAt - now <= soonMs)
    return { key: "sev.due", tone: "info" };
  return null;
}

async function safe<T>(call: Promise<T>, fallback: T): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return fallback;
    throw error;
  }
}

/* ----------------------------------------------------------------- loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const lanes = LANES.join(",");

  // One list call for the cards and one for the true depths. `count=true`
  // returns the total behind the page, which is what a WIP number has to mean —
  // a count of the rows that fit on screen would always look healthy.
  const [page, totals] = await Promise.all([
    safe(
      api<{ data: BoardCase[] }>(
        `/v1/axis/cases?status=${lanes}&sort=slaDueAt&order=asc&limit=${BOARD_PAGE}`,
        opts
      ),
      { data: [] as BoardCase[] }
    ),
    Promise.all(
      LANES.map(async (lane) => {
        const got = await safe(
          api<{ total?: number }>(`/v1/axis/cases?status=${lane}&count=true&limit=1`, opts),
          {}
        );
        return [lane, got.total ?? 0] as const;
      })
    )
  ]);

  return {
    now: Date.now(),
    cases: page.data,
    counts: Object.fromEntries(totals) as Partial<Record<Lane, number>>
  };
}

/* ----------------------------------------------------------------- action */

export interface Refusal {
  title: string;
  status: number;
  code?: string;
  detail?: string;
}

export interface ActionResult {
  problem: Refusal | null;
  done: string | null;
}

const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  done: null
});

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();

  // `assign` is the only write this board offers, and on purpose: ownership is
  // not workflow state. Anything that moves a case between lanes belongs behind
  // a transition endpoint with a state machine, which does not exist yet.
  if (String(form.get("intent") ?? "") !== "assign") return refuse("bad_intent");

  const id = String(form.get("caseId") ?? "").trim();
  const ownerRef = String(form.get("ownerRef") ?? "").trim();
  if (!id || !ownerRef) return refuse("missing_owner");

  try {
    await api(`/v1/axis/cases/${encodeURIComponent(id)}`, {
      env,
      request,
      method: "PATCH",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: { ownerRef }
    });
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null };
    throw error;
  }

  return { problem: null, done: "assign" };
}

/** Codes this screen can phrase; anything else keeps the API's own wording. */
export function phrase(problem: Refusal, l: Label): Refusal {
  const key = `problem.${problem.code ?? ""}`;
  const text = l(key);
  return text === key ? problem : { ...problem, title: text };
}

/* -------------------------------------------------------------- the screen */

export default function AxisBoard() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();

  const l = labelsIn(shell?.locale ?? "en");
  const held = new Set(shell?.permissions ?? []);
  const busy = navigation.state !== "idle";
  const now = loaded.now;

  const lanes = laneViews(loaded.cases, now, loaded.counts);
  const total = lanes.reduce((sum, lane) => sum + lane.open, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{l("title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("intro")}</p>
      </header>

      {result?.problem ? <Gate problem={phrase(result.problem, l)} l={l} /> : null}
      {result?.done ? (
        <p role="status" className="font-ui text-13 text-success">
          {l("done.assign")}
        </p>
      ) : null}

      <GuardrailNotice
        title={l("readonly.title")}
        reason={l("readonly.reason")}
        tone="info"
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to="/axis/cases">{l("readonly.action")}</Link>
          </Button>
        }
      />

      {total === 0 ? (
        <EmptyState title={l("empty.title")} body={l("empty.body")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {lanes.map((lane) => (
            <section
              key={lane.lane}
              aria-label={l(`lane.${lane.lane}`)}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="font-ui text-13 font-medium text-text">{l(`lane.${lane.lane}`)}</h2>
                <Badge tone={lane.congested ? "warning" : "neutral"} size="sm">
                  {lane.open}
                </Badge>
              </header>
              <p className="font-ui text-12 text-subtle">
                {lane.congested
                  ? l("wip.congested", { open: String(lane.open), limit: String(WIP_WARN) })
                  : l("wip.count", { open: String(lane.open) })}
              </p>

              <ul className="flex flex-col gap-2">
                {lane.cards.map((card) => {
                  const flag = flagOf(card, now);
                  return (
                    <li key={card.id}>
                      <Link
                        to={`/axis/cases/${card.id}`}
                        className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-2 hover:border-accent-line"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <Ref value={card.ref} className="text-12 text-accent" />
                          {flag ? (
                            <Badge tone={flag.tone} size="sm" dot>
                              {l(flag.key)}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="font-ui text-12 text-muted">{card.kind}</span>
                        <span className="flex items-center justify-between gap-2 font-ui text-12 text-subtle">
                          <span>{card.ownerRef ? shortRef(card.ownerRef) : l("unassigned")}</span>
                          {card.valueMinor !== null && card.currency ? (
                            <Money
                              amountMinor={card.valueMinor}
                              currency={card.currency}
                              locale={shell?.locale ?? "en"}
                            />
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {lane.open > lane.cards.length ? (
                <p className="font-ui text-12 text-subtle">
                  {l("overflow", { more: String(lane.open - lane.cards.length) })}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {held.has(PERM.write) && loaded.cases.length ? (
        <Card title={l("assign.title")}>
          <Form method="post" className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="intent" value="assign" />
            <Field label={l("assign.case")} className="w-64">
              <Select
                name="caseId"
                options={loaded.cases.map((row) => ({ value: row.id, label: row.ref }))}
              />
            </Field>
            <Field label={l("assign.owner")} hint={l("assign.intro")} className="w-64">
              <Input name="ownerRef" />
            </Field>
            <Button type="submit" variant="secondary" loading={busy}>
              {l("assign.submit")}
            </Button>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}
