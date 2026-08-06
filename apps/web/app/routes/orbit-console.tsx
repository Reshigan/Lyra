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
  AgentBadge,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  KPIWall,
  Stat,
  Table,
  type BadgeTone,
  type Column
} from "@lyra/ui";
import { api, asRouteError, fetchMe, type Problem as ProblemShape } from "../api.server";
import { cloudflare } from "../context";
import { Gate } from "./staff";
import { ORBIT, labelsFrom, refusal, safe, type Label, type Labels, type Page } from "./orbit-shared";

// The operator's view of the room: who the agent is holding, who a human is
// holding, and how long anybody has been waiting on a reply.
//
// ponytail: this is a snapshot with an explicit refresh, not a stream.
// apps/api/src/routes/realtime.ts serves SSE scoped to one actor's own queue
// (pullForActor), which a loader cannot subscribe to — and a fake stream that
// polls behind the user's back is worse than a button they can see. Upgrade
// path: a tenant-scoped realtime topic, then this renders the same list from it.

/* --------------------------------------------------------------- contract */

export interface LiveConversation {
  id: string;
  customerId: string | null;
  channel: string;
  state: string;
  assigneeRef: string | null;
  teamId: string | null;
  intent: string | null;
  sentiment: number | null;
  summary: string | null;
  lang: string | null;
  firstResponseMs: number | null;
  lastMessageAt: number | null;
  createdAt: number;
}

export interface HandoverNote {
  id: string;
  conversationId: string | null;
  fromRef: string | null;
  toRef: string | null;
  generatedBy: string | null;
  acceptedBy: string | null;
  ts: number;
}

/** Past this, a waiting customer is the thing to look at first. */
export const SLOW_MS = 15 * 60_000;

/** How long since anybody said anything on this conversation. */
export function waitingMs(row: LiveConversation, now: number): number {
  return Math.max(0, now - (row.lastMessageAt ?? row.createdAt));
}

export function waitLabel(ms: number, l: Label): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return l("waitMinutes", { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return l("waitHours", { n: String(hours) });
  return l("waitDays", { n: String(Math.floor(hours / 24)) });
}

/** Sentiment is −100…100 from the runtime; three buckets is all an operator reads. */
export function moodTone(sentiment: number | null): BadgeTone {
  if (sentiment === null) return "neutral";
  if (sentiment <= -25) return "danger";
  if (sentiment >= 25) return "success";
  return "warning";
}

export function moodKey(sentiment: number | null): string {
  if (sentiment === null) return "moodUnknown";
  if (sentiment <= -25) return "moodNegative";
  if (sentiment >= 25) return "moodPositive";
  return "moodNeutral";
}

/* ------------------------------------------------------------------ labels */

export const LABELS: Labels = {
  en: {
    title: "Live console",
    lede: "A snapshot of every open conversation. Refresh to pull the current state.",
    refresh: "Refresh",
    asOf: "As of",
    active: "Open conversations",
    handledByAgent: "Held by the agent",
    handledByHuman: "Held by a person",
    waitingLong: "Waiting over 15 minutes",
    agentQueue: "Agent is answering",
    agentQueueBody: "The AI agent holds these. Take one over and it moves to your name.",
    humanQueue: "People are answering",
    humanQueueBody: "Already with a person. Waiting time is since the last message either way.",
    recentHandovers: "Recent handovers",
    recentHandoversBody: "Every take-over writes a note the next person can read.",
    customer: "Customer",
    channel: "Channel",
    intent: "Intent",
    mood: "Mood",
    waiting: "Waiting",
    assignee: "With",
    lastMessage: "Last message",
    act: "Action",
    take: "Take over",
    taking: "Taking over",
    tookIt: "That conversation is yours now.",
    openThread: "Open thread",
    from: "From",
    to: "To",
    when: "When",
    written: "Note written by",
    noneAgent: "Nothing is waiting on the agent.",
    noneHuman: "Nobody is holding a conversation.",
    noneHandovers: "No handovers yet.",
    noneBody: "Refresh once a conversation opens.",
    moodPositive: "Positive",
    moodNeutral: "Neutral",
    moodNegative: "Negative",
    moodUnknown: "Unread",
    waitMinutes: "{n} min",
    waitHours: "{n} h",
    waitDays: "{n} d",
    unassigned: "Unassigned",
    whatsapp: "WhatsApp",
    web: "Web",
    voice: "Voice",
    email: "Email",
    agent: "Agent channel",
    unknownIntent: "That control is not available.",
    missingConversation: "Pick a conversation first.",
    approvalTitle: "This needs an approval",
    approvalBody: "Policy {policy} holds this action until somebody approves it.",
    approvalLink: "Open approvals"
  },
  ar: {
    title: "لوحة المتابعة الحية",
    lede: "لمحة عن كل محادثة مفتوحة. حدّث الصفحة لجلب الحالة الحالية.",
    refresh: "تحديث",
    asOf: "حتى",
    active: "المحادثات المفتوحة",
    handledByAgent: "بيد الوكيل الذكي",
    handledByHuman: "بيد موظف",
    waitingLong: "انتظار أكثر من ١٥ دقيقة",
    agentQueue: "الوكيل الذكي يجيب",
    agentQueueBody: "الوكيل الذكي يحمل هذه المحادثات. تولَّ واحدة فتنتقل إلى اسمك.",
    humanQueue: "الموظفون يجيبون",
    humanQueueBody: "مع موظف بالفعل. مدة الانتظار محسوبة من آخر رسالة في الحالتين.",
    recentHandovers: "التسليمات الأخيرة",
    recentHandoversBody: "كل تولٍّ يكتب ملاحظة يقرأها من يأتي بعدك.",
    customer: "العميل",
    channel: "القناة",
    intent: "الغرض",
    mood: "المزاج",
    waiting: "الانتظار",
    assignee: "لدى",
    lastMessage: "آخر رسالة",
    act: "إجراء",
    take: "تولَّ المحادثة",
    taking: "جارٍ التولي",
    tookIt: "المحادثة لك الآن.",
    openThread: "افتح المحادثة",
    from: "من",
    to: "إلى",
    when: "الوقت",
    written: "كاتب الملاحظة",
    noneAgent: "لا شيء ينتظر الوكيل الذكي.",
    noneHuman: "لا أحد يحمل محادثة.",
    noneHandovers: "لا تسليمات بعد.",
    noneBody: "حدّث الصفحة بعد فتح محادثة.",
    moodPositive: "إيجابي",
    moodNeutral: "محايد",
    moodNegative: "سلبي",
    moodUnknown: "غير مقروء",
    waitMinutes: "{n} دقيقة",
    waitHours: "{n} ساعة",
    waitDays: "{n} يوم",
    unassigned: "غير مُسند",
    whatsapp: "واتساب",
    web: "الويب",
    voice: "صوت",
    email: "البريد الإلكتروني",
    agent: "قناة الوكيل",
    unknownIntent: "هذا الإجراء غير متاح.",
    missingConversation: "اختر محادثة أولًا.",
    approvalTitle: "هذا الإجراء يحتاج موافقة",
    approvalBody: "السياسة {policy} تحتجز هذا الإجراء حتى يوافق عليه شخص مسؤول.",
    approvalLink: "افتح الموافقات"
  }
};

export function labelsIn(locale: string): Label {
  return labelsFrom(LABELS, locale);
}

/* ------------------------------------------------------------------ loader */

const LIVE = "sort=lastMessageAt&order=desc&limit=50&count=true";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const me = await fetchMe(env, request).catch(asRouteError);
  const held = new Set(me.permissions);
  const empty: Page<LiveConversation> = { data: [], total: 0 };

  const [bot, human, handovers] = await Promise.all([
    held.has(ORBIT.conversations)
      ? safe(() => api<Page<LiveConversation>>(`/v1/orbit/conversations?state=bot&${LIVE}`, opts), empty)
      : Promise.resolve(empty),
    held.has(ORBIT.conversations)
      ? safe(() => api<Page<LiveConversation>>(`/v1/orbit/conversations?state=human&${LIVE}`, opts), empty)
      : Promise.resolve(empty),
    held.has(ORBIT.handovers)
      ? safe(
          () => api<Page<HandoverNote>>("/v1/orbit/handover-notes?sort=ts&order=desc&limit=10", opts),
          { data: [] } as Page<HandoverNote>
        )
      : Promise.resolve({ data: [] } as Page<HandoverNote>)
  ]);

  return {
    locale: me.locale,
    now: Date.now(),
    nonce: crypto.randomUUID(),
    may: { read: held.has(ORBIT.conversations), take: held.has(ORBIT.assign) },
    bot,
    human,
    handovers: handovers.data
  };
}

/* ------------------------------------------------------------------ action */

interface ActionResult {
  problem: ProblemShape | null;
  took: string | null;
}

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "take") {
    return { problem: { title: "unknown_intent", status: 400 }, took: null };
  }
  const id = String(form.get("id") ?? "");
  if (!id) return { problem: { title: "missing_conversation", status: 400 }, took: null };

  try {
    // The shell ships permissions, never an actor id — so ask who this is
    // before writing an assignee (same reason as routes/conversation.tsx).
    const me = await fetchMe(env, request);
    await api(`/v1/orbit/conversations/${id}`, {
      env,
      request,
      method: "PATCH",
      headers: { "idempotency-key": String(form.get("nonce") ?? crypto.randomUUID()) },
      body: { assigneeRef: me.actor.id, state: "human" }
    });
    return { problem: null, took: id };
  } catch (error) {
    return { problem: refusal(error), took: null };
  }
}

/* --------------------------------------------------------------- component */

export default function OrbitConsole() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const l = labelsIn(loaded.locale);
  const busy = navigation.state === "submitting";
  const waitingLong = [...loaded.bot.data, ...loaded.human.data].filter(
    (row) => waitingMs(row, loaded.now) >= SLOW_MS
  ).length;

  const problemMessage: Record<string, string> = {
    unknown_intent: l("unknownIntent"),
    missing_conversation: l("missingConversation")
  };
  const local = result?.problem ? problemMessage[result.problem.title] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-24 leading-[1.2] text-text">{l("title")}</h1>
          <p className="font-ui text-13 text-muted">{l("lede")}</p>
        </div>
        <Form method="get" replace className="flex items-center gap-3">
          <span className="font-ui text-12 text-subtle">
            {l("asOf")} <DateTime value={loaded.now} locale={loaded.locale} precision="minute" />
          </span>
          <Button type="submit" variant="secondary" size="sm">
            {l("refresh")}
          </Button>
        </Form>
      </header>

      {local ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="font-ui text-13 text-text">{local}</p>
        </div>
      ) : null}
      {result?.problem && !local ? <Gate problem={result.problem} l={l} /> : null}
      {result?.took ? (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 p-3">
          <p className="font-ui text-13 text-text">{l("tookIt")}</p>
        </div>
      ) : null}

      <KPIWall>
        <Stat
          label={l("active")}
          value={String((loaded.bot.total ?? loaded.bot.data.length) + (loaded.human.total ?? loaded.human.data.length))}
        />
        <Stat label={l("handledByAgent")} value={String(loaded.bot.total ?? loaded.bot.data.length)} />
        <Stat label={l("handledByHuman")} value={String(loaded.human.total ?? loaded.human.data.length)} />
        <Stat label={l("waitingLong")} value={String(waitingLong)} live={waitingLong > 0} />
      </KPIWall>

      <Card title={l("agentQueue")} description={l("agentQueueBody")}>
        <Queue
          rows={loaded.bot.data}
          l={l}
          locale={loaded.locale}
          now={loaded.now}
          nonce={loaded.nonce}
          takeable={loaded.may.take}
          busy={busy}
          emptyTitle={l("noneAgent")}
        />
      </Card>

      <Card title={l("humanQueue")} description={l("humanQueueBody")}>
        <Queue
          rows={loaded.human.data}
          l={l}
          locale={loaded.locale}
          now={loaded.now}
          nonce={loaded.nonce}
          takeable={false}
          busy={busy}
          emptyTitle={l("noneHuman")}
        />
      </Card>

      <Card title={l("recentHandovers")} description={l("recentHandoversBody")}>
        {loaded.handovers.length === 0 ? (
          <EmptyState title={l("noneHandovers")} body={l("noneBody")} />
        ) : (
          <Table
            caption={l("recentHandovers")}
            rows={loaded.handovers}
            rowKey={(row) => row.id}
            density="compact"
            columns={[
              {
                key: "conversationId",
                header: l("customer"),
                render: (row) =>
                  row.conversationId ? (
                    <Link
                      to={`/orbit/conversations/${row.conversationId}/thread`}
                      className="font-mono text-12 text-accent underline underline-offset-2"
                    >
                      {row.conversationId}
                    </Link>
                  ) : (
                    <span className="text-subtle">{l("unassigned")}</span>
                  )
              },
              { key: "fromRef", header: l("from"), render: (row) => row.fromRef ?? "—" },
              { key: "toRef", header: l("to"), render: (row) => row.toRef ?? "—" },
              {
                key: "generatedBy",
                header: l("written"),
                // ponytail: AgentBadge ships its own English chrome (packages/ui);
                // translating the primitive is a @lyra/ui change, not a screen change.
                render: (row) =>
                  row.generatedBy?.startsWith("agent:") ? (
                    <AgentBadge agent={row.generatedBy.slice("agent:".length)} />
                  ) : (
                    <span className="font-ui text-12 text-muted">{row.generatedBy ?? "—"}</span>
                  )
              },
              {
                key: "ts",
                header: l("when"),
                render: (row) => <DateTime value={row.ts} locale={loaded.locale} relative />
              }
            ] satisfies Column<HandoverNote>[]}
          />
        )}
      </Card>
    </div>
  );
}

function Queue({
  rows,
  l,
  locale,
  now,
  nonce,
  takeable,
  busy,
  emptyTitle
}: {
  rows: LiveConversation[];
  l: Label;
  locale: string;
  now: number;
  nonce: string;
  takeable: boolean;
  busy: boolean;
  emptyTitle: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={l("noneBody")} />;

  const columns: Column<LiveConversation>[] = [
    {
      key: "customerId",
      header: l("customer"),
      render: (row) => (
        <div className="flex flex-col">
          <Link
            to={`/orbit/conversations/${row.id}/thread`}
            className="font-ui text-13 text-accent underline underline-offset-2"
          >
            {row.customerId ?? row.id}
          </Link>
          {row.summary ? <span className="font-ui text-11 text-subtle">{row.summary}</span> : null}
        </div>
      )
    },
    { key: "channel", header: l("channel"), render: (row) => <Badge tone="neutral">{l(row.channel)}</Badge> },
    { key: "intent", header: l("intent"), render: (row) => row.intent ?? "—" },
    {
      key: "sentiment",
      header: l("mood"),
      render: (row) => <Badge tone={moodTone(row.sentiment)}>{l(moodKey(row.sentiment))}</Badge>
    },
    {
      key: "waiting",
      header: l("waiting"),
      numeric: true,
      render: (row) => {
        const ms = waitingMs(row, now);
        return (
          <span className={ms >= SLOW_MS ? "font-ui text-13 font-medium text-danger" : "font-ui text-13 text-text"}>
            {waitLabel(ms, l)}
          </span>
        );
      }
    },
    {
      key: "assigneeRef",
      header: l("assignee"),
      render: (row) =>
        row.assigneeRef ?? <span className="font-ui text-12 text-subtle">{l("unassigned")}</span>
    },
    {
      key: "lastMessageAt",
      header: l("lastMessage"),
      render: (row) => <DateTime value={row.lastMessageAt ?? row.createdAt} locale={locale} relative />
    }
  ];

  if (takeable) {
    columns.push({
      key: "act",
      header: l("act"),
      render: (row) => (
        <Form method="post" replace>
          <input type="hidden" name="intent" value="take" />
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="nonce" value={`${nonce}:${row.id}`} />
          <Button type="submit" variant="secondary" size="sm" disabled={busy}>
            {busy ? l("taking") : l("take")}
          </Button>
        </Form>
      )
    });
  }

  return <Table caption={l("title")} rows={rows} rowKey={(row) => row.id} columns={columns} density="compact" />;
}
