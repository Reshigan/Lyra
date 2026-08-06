import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Badge, Button, Card, DateTime, EmptyState, KPIWall, Stat, type BadgeTone } from "@lyra/ui";
import { api, asRouteError, fetchMe, type Problem as ProblemShape } from "../api.server";
import { cloudflare } from "../context";
import { Gate } from "./staff";
import {
  ORBIT,
  daysUntil,
  labelsFrom,
  refusal,
  safe,
  type Label,
  type Labels,
  type Page
} from "./orbit-shared";
import type { Renewal } from "./orbit-save";

// Renewals as the pipeline they are: raised, offered, then won or lost, with
// how many days are left on each. The stage order is the API's transition table
// (RENEWAL_TRANSITIONS in apps/api/src/resources.ts) read left to right, so a
// card can only ever move one way along this board.
//
// Moves are made on the save desk (/orbit/save) and on the record, not here —
// this is the board you read. The one write is the expiry sweep, which is the
// job that puts cards on it.

/* --------------------------------------------------------------- contract */

export const STAGES = ["scheduled", "offered", "accepted", "lost"] as const;
export type Stage = (typeof STAGES)[number];

/** Stage colour: open work is neutral, a decision is its outcome. */
export function stageTone(stage: Stage): BadgeTone {
  if (stage === "accepted") return "success";
  if (stage === "lost") return "danger";
  if (stage === "offered") return "accent";
  return "neutral";
}

/** Days left decide what a card looks like — the board is read by urgency. */
export function urgency(days: number | null): "gone" | "now" | "soon" | "later" {
  if (days === null) return "later";
  if (days < 0) return "gone";
  if (days <= 7) return "now";
  if (days <= 30) return "soon";
  return "later";
}

const URGENCY_CLASS: Record<ReturnType<typeof urgency>, string> = {
  gone: "border-danger/60 bg-danger/8",
  now: "border-warning/60 bg-warning/8",
  soon: "border-line bg-surface-2",
  later: "border-line bg-surface-1"
};

/* ------------------------------------------------------------------ labels */

export const LABELS: Labels = {
  en: {
    title: "Renewal pipeline",
    lede: "Every renewal by stage, soonest expiry first. Cards move as decisions are recorded.",
    inFlight: "Open renewals",
    expiringWeek: "Expiring within 7 days",
    overdue: "Past expiry, undecided",
    winRate: "Win rate on decided",
    sweep: "Raise due renewals",
    sweepBody: "Scans for policies approaching expiry and raises a renewal for each.",
    sweeping: "Raising",
    swept: "Raised {n} renewal(s).",
    scheduled: "Raised",
    offered: "Offer out",
    accepted: "Renewed",
    lost: "Lost",
    stageCount: "{n} in this stage",
    daysLeft: "{n} days left",
    daysOver: "{n} days past expiry",
    noExpiry: "No expiry date",
    risk: "Risk {n}",
    open: "Open renewal",
    saveDesk: "Open the save desk",
    empty: "Nothing at this stage",
    emptyBody: "Cards arrive here as the sweep raises renewals and decisions are recorded.",
    auto_requote: "Auto re-quote",
    human: "Handled by a person",
    do_not_contact: "Do not contact",
    unknownIntent: "That control is not available.",
    approvalTitle: "This needs an approval",
    approvalBody: "Policy {policy} holds this action until somebody approves it.",
    approvalLink: "Open approvals"
  },
  ar: {
    title: "مسار التجديدات",
    lede: "كل تجديد حسب مرحلته، الأقرب انتهاءً أولًا. تنتقل البطاقات مع تسجيل القرارات.",
    inFlight: "التجديدات المفتوحة",
    expiringWeek: "تنتهي خلال ٧ أيام",
    overdue: "تجاوزت الانتهاء دون قرار",
    winRate: "نسبة الفوز من المحسوم",
    sweep: "ارفع التجديدات المستحقة",
    sweepBody: "يبحث عن الوثائق التي تقارب الانتهاء ويرفع تجديدًا لكل منها.",
    sweeping: "جارٍ الرفع",
    swept: "تم رفع {n} تجديد.",
    scheduled: "مرفوع",
    offered: "عرض قائم",
    accepted: "مُجدَّد",
    lost: "خسارة",
    stageCount: "{n} في هذه المرحلة",
    daysLeft: "بقي {n} يوم",
    daysOver: "مضى {n} يوم على الانتهاء",
    noExpiry: "لا تاريخ انتهاء",
    risk: "الخطر {n}",
    open: "افتح التجديد",
    saveDesk: "افتح مكتب الاستبقاء",
    empty: "لا شيء في هذه المرحلة",
    emptyBody: "تصل البطاقات هنا مع رفع التجديدات وتسجيل القرارات.",
    auto_requote: "إعادة تسعير تلقائية",
    human: "يتولاها موظف",
    do_not_contact: "عدم التواصل",
    unknownIntent: "هذا الإجراء غير متاح.",
    approvalTitle: "هذا الإجراء يحتاج موافقة",
    approvalBody: "السياسة {policy} تحتجز هذا الإجراء حتى يوافق عليه شخص مسؤول.",
    approvalLink: "افتح الموافقات"
  }
};

export function labelsIn(locale: string): Label {
  return labelsFrom(LABELS, locale);
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const me = await fetchMe(env, request).catch(asRouteError);
  const held = new Set(me.permissions);
  const empty: Page<Renewal> = { data: [], total: 0 };

  const columns = await Promise.all(
    STAGES.map((stage) =>
      held.has(ORBIT.renewals)
        ? safe(
            () =>
              api<Page<Renewal>>(
                `/v1/orbit/renewals?state=${stage}&sort=expiryAt&order=asc&limit=25&count=true`,
                opts
              ),
            empty
          )
        : Promise.resolve(empty)
    )
  );

  const board = Object.fromEntries(STAGES.map((stage, index) => [stage, columns[index] ?? empty])) as Record<
    Stage,
    Page<Renewal>
  >;

  return {
    locale: me.locale,
    now: Date.now(),
    nonce: crypto.randomUUID(),
    may: { read: held.has(ORBIT.renewals), sweep: held.has(ORBIT.renewalsWrite) },
    board
  };
}

/* ------------------------------------------------------------------ action */

interface ActionResult {
  problem: ProblemShape | null;
  raised: number | null;
}

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "sweep") {
    return { problem: { title: "unknown_intent", status: 400 }, raised: null };
  }
  try {
    const result = await api<{ raised: number }>("/v1/orbit/renewals/sweep", {
      env,
      request,
      method: "POST",
      headers: { "idempotency-key": String(form.get("nonce") ?? crypto.randomUUID()) },
      body: {}
    });
    return { problem: null, raised: result.raised };
  } catch (error) {
    return { problem: refusal(error), raised: null };
  }
}

/* --------------------------------------------------------------- component */

export default function RenewalPipeline() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const l = labelsIn(loaded.locale);
  const busy = navigation.state === "submitting";

  const open = [...loaded.board.scheduled.data, ...loaded.board.offered.data];
  const soon = open.filter((row) => urgency(daysUntil(row.expiryAt, loaded.now)) === "now").length;
  const gone = open.filter((row) => urgency(daysUntil(row.expiryAt, loaded.now)) === "gone").length;
  const won = loaded.board.accepted.total ?? loaded.board.accepted.data.length;
  const lost = loaded.board.lost.total ?? loaded.board.lost.data.length;
  const winRate = won + lost === 0 ? 0 : Math.round((won / (won + lost)) * 100);
  const openTotal =
    (loaded.board.scheduled.total ?? loaded.board.scheduled.data.length) +
    (loaded.board.offered.total ?? loaded.board.offered.data.length);

  const local = result?.problem?.title === "unknown_intent" ? l("unknownIntent") : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-24 text-text">{l("title")}</h1>
          <p className="font-ui text-13 text-muted">{l("lede")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/orbit/save" className="font-ui text-13 text-accent underline underline-offset-2">
            {l("saveDesk")}
          </Link>
          {loaded.may.sweep ? (
            <Form method="post" replace>
              <input type="hidden" name="intent" value="sweep" />
              <input type="hidden" name="nonce" value={loaded.nonce} />
              <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                {busy ? l("sweeping") : l("sweep")}
              </Button>
            </Form>
          ) : null}
        </div>
      </header>

      {local ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="font-ui text-13 text-text">{local}</p>
        </div>
      ) : null}
      {result?.problem && !local ? <Gate problem={result.problem} l={l} /> : null}
      {result?.raised !== null && result?.raised !== undefined ? (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 p-3">
          <p className="font-ui text-13 text-text">{l("swept", { n: String(result.raised) })}</p>
        </div>
      ) : null}

      <KPIWall>
        <Stat label={l("inFlight")} value={String(openTotal)} />
        <Stat label={l("expiringWeek")} value={String(soon)} live={soon > 0} />
        <Stat label={l("overdue")} value={String(gone)} />
        <Stat label={l("winRate")} value={`${winRate}%`} hint={l("sweepBody")} />
      </KPIWall>

      <div className="grid gap-4 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const column = loaded.board[stage];
          const count = column.total ?? column.data.length;
          return (
            <Card
              key={stage}
              title={
                <span className="flex items-center gap-2">
                  <Badge tone={stageTone(stage)}>{l(stage)}</Badge>
                  <span className="font-ui text-12 text-subtle">{l("stageCount", { n: String(count) })}</span>
                </span>
              }
            >
              {column.data.length === 0 ? (
                <EmptyState title={l("empty")} body={l("emptyBody")} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {column.data.map((row) => {
                    const days = daysUntil(row.expiryAt, loaded.now);
                    const heat = urgency(days);
                    return (
                      <li key={row.id} className={`rounded-md border p-3 ${URGENCY_CLASS[heat]}`}>
                        <Link
                          to={`/orbit/renewals/${row.id}`}
                          className="font-ui text-13 text-accent underline underline-offset-2"
                        >
                          {row.customerId ?? row.id}
                        </Link>
                        {row.policyRef ? (
                          <p className="font-mono text-11 text-subtle">{row.policyRef}</p>
                        ) : null}
                        <p className="font-ui text-12 text-muted">
                          {days === null
                            ? l("noExpiry")
                            : days < 0
                              ? l("daysOver", { n: String(-days) })
                              : l("daysLeft", { n: String(days) })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {row.churnScore === null ? null : (
                            <Badge tone={row.churnScore >= 65 ? "warning" : "neutral"} size="sm">
                              {l("risk", { n: String(row.churnScore) })}
                            </Badge>
                          )}
                          <Badge tone="neutral" size="sm">
                            {l(row.strategy)}
                          </Badge>
                          {row.expiryAt ? (
                            <span className="font-ui text-11 text-subtle">
                              <DateTime value={row.expiryAt} locale={loaded.locale} precision="day" />
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
