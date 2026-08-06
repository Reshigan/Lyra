import { useState, type ReactNode } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  AGENT_MARK,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  Field,
  Money,
  Select,
  Textarea
} from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { toneFor } from "../components/fields";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { WORKSPACES } from "../modules";
import { Problem } from "./module";
import { useShellData } from "./workspace";

// The human-in-the-loop queue (CLAUDE.md §4). Everything consequential the
// platform tried to do and could not do alone lands here: one card per request,
// the rule that stopped it, and two buttons. Nothing on this screen decides
// anything by itself — the decision is a POST, and what renders afterwards is
// whatever the API said came back.

/** Mirrors packages/core/src/approvals.ts. The web app cannot import @lyra/core. */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const STATES = ["pending", "approved", "rejected"] as const;
type State = (typeof STATES)[number];

/** Context keys rendered as their own field; the rest are the "why" list. */
const OWN_FIELD = new Set(["amountMinor", "currency", "dualControl", "expiresAt"]);

interface ApprovalRow {
  id: string;
  subjectRef: string;
  policyKey: string;
  module: string;
  requestedBy: string;
  requestedAt: number;
  decidedBy: string | null;
  decision: string;
  reason: string | null;
  /** A string from /v1/me/inbox, already parsed by the CRUD list. Take both. */
  contextJson: string | Record<string, unknown> | null;
  decidedAt: number | null;
}

interface AiRun {
  id: string;
  agentKey: string;
  approvalId: string | null;
}

function contextOf(row: ApprovalRow): Record<string, unknown> {
  const raw = row.contextJson;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A malformed context is a data bug. Losing it must not lose the approval.
    return {};
  }
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * `subjectRef` is `<resource>:<rowId>` for a change to a record and
 * `<resource>:new:<hash>` for one that would create it (apps/api/src/crud.ts).
 * The resource is the API's own path segment, which is exactly the last segment
 * of a spec's `api` — so the record route can be rebuilt from it. Anything that
 * does not resolve stays plain text: a link that 404s is worse than none.
 */
function subjectOf(subjectRef: string): { text: string; href: string | null; unborn: boolean } {
  const first = subjectRef.indexOf(":");
  if (first < 0) return { text: subjectRef, href: null, unborn: false };
  const resource = subjectRef.slice(0, first);
  const rest = subjectRef.slice(first + 1);
  if (rest.startsWith("new:")) return { text: resource, href: null, unborn: true };

  for (const workspace of WORKSPACES) {
    for (const tab of workspace.tabs) {
      if (tab.api.endsWith(`/${resource}`)) {
        return {
          text: rest,
          href: `/${workspace.path}/${tab.key}/${encodeURIComponent(rest)}`,
          unborn: false
        };
      }
    }
  }
  // A hand-written engine (dist, ledger) names subjects its own way, and those
  // have no generic record screen to point at.
  return { text: subjectRef, href: null, unborn: false };
}

/** A panel the actor may not read is missing, not fatal. 401 is the session's
 *  business and stays thrown, so the layout can send them to sign in. */
async function soft<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) return null;
    throw error;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const state: State = STATES.find((s) => s === url.searchParams.get("state")) ?? "pending";
  const cursor = url.searchParams.get("cursor") ?? "";

  // /v1/me a second time: the layout keeps neither the tenant's base currency
  // nor the raw permission list, and an amount rendered without its currency is
  // not money (docs/22 §5.1).
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const baseCurrency = typeof me.policy.currency === "string" ? me.policy.currency : null;
  const canReadDecided = held.has("core:approvals:read");

  let rows: ApprovalRow[] = [];
  let next: string | null = null;
  let readable = true;

  if (state === "pending") {
    // The inbox is the only endpoint that answers "waiting for THIS actor": it
    // keeps the rows whose policy names a permission this actor holds. The CRUD
    // list would hand back every pending row in the tenant instead.
    const inbox = await soft(api<{ approvals: ApprovalRow[] }>("/v1/me/inbox", { env, request }));
    readable = inbox !== null;
    rows = inbox?.approvals ?? [];
  } else if (canReadDecided) {
    const page = await soft(
      api<{ data: ApprovalRow[]; cursor?: string }>(
        `/v1/core/approvals?decision=${state}&sort=requestedAt&order=desc&limit=25` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
        { env, request }
      )
    );
    readable = page !== null;
    rows = page?.data ?? [];
    next = page?.cursor ?? null;
  } else {
    // Asked for a state this actor cannot read — by typing the query string, or
    // by holding the permission when the page loaded and losing it since.
    readable = false;
  }

  // Which of these an agent produced, in one call rather than one per row: the
  // list filter takes a comma-separated set as an OR. A refusal here costs the
  // run link and nothing else, so it must not cost the queue.
  const runs: Record<string, { id: string; agentKey: string }> = {};
  if (rows.length && held.has("ai:runs:read")) {
    const ids = rows.map((row) => row.id).join(",");
    const page = await soft(
      api<{ data: AiRun[] }>(
        `/v1/ai/runs?approvalId=${encodeURIComponent(ids)}&limit=${rows.length}`,
        { env, request }
      )
    );
    for (const run of page?.data ?? []) {
      if (run.approvalId) runs[run.approvalId] = { id: run.id, agentKey: run.agentKey };
    }
  }

  // `${kind}:${id}`, exactly as packages/core/src/approvals.ts writes it into
  // `requestedBy` — so "did I raise this?" is a string comparison and not a guess.
  const actorRef = `${me.actor.kind}:${me.actor.id}`;

  const items = rows.map((row) => {
    const ctx = contextOf(row);
    return {
      id: row.id,
      subject: subjectOf(row.subjectRef),
      /** Dual control refuses a decision by the initiator. Saying so before the
       *  press beats a 400 after it. */
      selfRaised: row.requestedBy === actorRef,
      policyKey: row.policyKey,
      module: row.module,
      requestedBy: row.requestedBy,
      requestedAt: row.requestedAt,
      decision: row.decision,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      reason: row.reason,
      amountMinor: typeof ctx.amountMinor === "number" ? ctx.amountMinor : null,
      currency: typeof ctx.currency === "string" ? ctx.currency : baseCurrency,
      dualControl: ctx.dualControl === true,
      /**
       * core_approvals has no expiry column. What lapses is the authority a
       * decision grants: `gate()` re-asks once a decision is older than
       * APPROVAL_TTL_MS. A pending request does not lapse, so it shows no
       * deadline rather than a countdown we would be inventing.
       */
      expiresAt:
        typeof ctx.expiresAt === "number"
          ? ctx.expiresAt
          : row.decidedAt
            ? row.decidedAt + APPROVAL_TTL_MS
            : null,
      // The rule's own detail — thresholds, the quoted reason, what changed.
      // Whatever the gate recorded is what the approver gets to read.
      why: Object.entries(ctx)
        .filter(([key]) => !OWN_FIELD.has(key))
        .map(([key, value]) => ({
          key,
          text: display(value),
          minor: key.endsWith("Minor") && typeof value === "number" ? value : null
        })),
      // An agent-raised request is marked even when the actor cannot open the
      // run: the ✦ comes from who asked, the link from the run lookup.
      agentRaised: row.requestedBy.startsWith("agent:") || Boolean(runs[row.id]),
      run: runs[row.id] ?? null
    };
  });

  return { state, items, cursor: next, canReadDecided, readable };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!id || (intent !== "approve" && intent !== "reject")) {
    return { id, problem: { title: "unknown intent", status: 400 }, decided: null };
  }

  try {
    // The single decision endpoint. Permission, dual control, the rejection
    // reason rule and the audit row all live behind it — this posts one
    // approval at a time because that is all the API offers, and a bulk
    // decision this screen faked would be a decision nobody made.
    const row = await api<ApprovalRow>(`/v1/me/approvals/${encodeURIComponent(id)}/decide`, {
      env,
      request,
      method: "POST",
      body: {
        decision: intent === "approve" ? "approved" : "rejected",
        ...(reason ? { reason } : {})
      }
    });
    // Only what came back is reported. A decision is irreversible, so the
    // screen never claims one the API has not confirmed.
    return { id, problem: null, decided: { id: row.id, decision: row.decision } };
  } catch (error) {
    if (error instanceof ApiError) return { id, problem: error.problem, decided: null };
    throw error;
  }
}

/**
 * This screen owns its strings: the shared catalogue in app/i18n belongs to
 * another surface, and a queue that only exists here has no business widening
 * it. Same discipline as the catalogue — no literal reaches the markup.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Approvals",
    intro:
      "Actions that need a person before they take effect. A decision is final and is written to the audit log.",
    state: "State",
    "state.pending": "Awaiting decision",
    "state.approved": "Approved",
    "state.rejected": "Rejected",
    queue: "Requests",
    rule: "Rule",
    module: "Area",
    subject: "Subject",
    requestedBy: "Requested by",
    requested: "Requested",
    amount: "Amount",
    expires: "Authority expires",
    expiresOnDecision: "Set when decided",
    why: "Why this needs approval",
    control: "Approvers",
    dualControl: "Two people: whoever raised this may not decide it.",
    singleControl: "One approver.",
    reason: "Reason",
    reasonHint: "Required to reject, kept with the decision in the audit log.",
    reasonRequired: "Say why you are rejecting this.",
    approve: "Approve",
    reject: "Reject",
    confirmReject: "Reject this request? A decision cannot be undone.",
    decidedBy: "Decided by",
    decidedAt: "Decided",
    agent: "Raised by an agent",
    openRun: "Open the run",
    openRecord: "Open the record",
    subjectNew: "No record yet — approving this is what creates it.",
    selfRaised: "You raised this request, and this rule needs a second person to decide it.",
    noPermission: "Decisions across the tenant are not yours to read, so this list stays empty.",
    unavailable: "The queue could not be read just now.",
    emptyPending: "Nothing is waiting for your decision.",
    emptyDecided: "No decisions in this state yet.",
    announceApproved: "Approved. The action may now proceed.",
    announceRejected: "Rejected. The action will not proceed."
  },
  ar: {
    title: "الموافقات",
    intro: "إجراءات تحتاج قرار شخص قبل تنفيذها. القرار نهائي ويُسجَّل في سجل التدقيق.",
    state: "الحالة",
    "state.pending": "بانتظار القرار",
    "state.approved": "تمت الموافقة",
    "state.rejected": "مرفوض",
    queue: "الطلبات",
    rule: "القاعدة",
    module: "المجال",
    subject: "الموضوع",
    requestedBy: "طلبها",
    requested: "تاريخ الطلب",
    amount: "المبلغ",
    expires: "تنتهي الصلاحية",
    expiresOnDecision: "تُحدَّد عند القرار",
    why: "سبب طلب الموافقة",
    control: "الموافقون",
    dualControl: "شخصان: لا يجوز لمن طلبها أن يقرّرها.",
    singleControl: "موافق واحد.",
    reason: "السبب",
    reasonHint: "مطلوب عند الرفض، ويُحفظ مع القرار في سجل التدقيق.",
    reasonRequired: "اذكر سبب الرفض.",
    approve: "الموافقة",
    reject: "الرفض",
    confirmReject: "هل تريد رفض هذا الطلب؟ لا يمكن التراجع عن القرار.",
    decidedBy: "قرّرها",
    decidedAt: "تاريخ القرار",
    agent: "طلبها وكيل ذكاء اصطناعي",
    openRun: "فتح سجل التشغيل",
    openRecord: "فتح السجل",
    subjectNew: "لا يوجد سجل بعد — الموافقة هي ما يُنشئه.",
    selfRaised: "أنت من طلب هذا، وهذه القاعدة تتطلب شخصًا ثانيًا ليقرّر.",
    noPermission: "قرارات المؤسسة ليست من صلاحيتك للاطلاع، لذلك تبقى هذه القائمة فارغة.",
    unavailable: "تعذّرت قراءة قائمة الطلبات الآن.",
    emptyPending: "لا يوجد ما ينتظر قرارك.",
    emptyDecided: "لا قرارات في هذه الحالة بعد.",
    announceApproved: "تمت الموافقة. يمكن تنفيذ الإجراء الآن.",
    announceRejected: "تم الرفض. لن يُنفَّذ الإجراء."
  }
};

function labeller(locale: string): (key: string) => string {
  const table = LABELS[locale] ?? LABELS.en!;
  return (key) => table[key] ?? LABELS.en![key] ?? key;
}

export default function Approvals() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labeller(locale);
  const busy = navigation.state !== "idle";
  const deciding = navigation.formData?.get("id");
  const items = loaded.items;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{l("title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("intro")}</p>
      </header>

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <Select
          name="state"
          aria-label={l("state")}
          defaultValue={loaded.state}
          options={STATES.filter(
            // Decided rows come from the tenant-wide list, which is gated. An
            // option that can only 403 is not offered.
            (state) => state === "pending" || loaded.canReadDecided
          ).map((state) => ({ value: state, label: l(`state.${state}`) }))}
        />
        <Button type="submit" variant="secondary" loading={busy}>
          {t("common.apply")}
        </Button>
        {searchParams.get("state") || searchParams.get("cursor") ? (
          <Button asChild variant="ghost">
            <Link to="/approvals">{t("common.clear")}</Link>
          </Button>
        ) : null}
      </Form>

      {/* The confirmed outcome, announced once the API has answered. */}
      <p role="status" aria-live="polite" className="font-ui text-13 text-success">
        {result?.decided
          ? result.decided.decision === "approved"
            ? l("announceApproved")
            : l("announceRejected")
          : ""}
      </p>

      {/* A refusal belongs beside the request it refused; this catches only the
          orphan — a decision on a row that is no longer in the list. */}
      {result?.problem && !items.some((item) => item.id === result.id) ? (
        <Problem problem={result.problem} />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={t("common.empty.title")}
          body={
            !loaded.readable
              ? loaded.state === "pending"
                ? l("unavailable")
                : l("noPermission")
              : loaded.state === "pending"
                ? l("emptyPending")
                : l("emptyDecided")
          }
        />
      ) : (
        <ul aria-label={l("queue")} className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <ApprovalCard
                item={item}
                locale={locale}
                l={l}
                t={t}
                busy={busy}
                deciding={deciding}
                problem={result?.id === item.id ? (result.problem ?? null) : null}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between gap-2">
        <span className="font-ui text-12 tabular-nums text-subtle">
          {t("common.rows", { count: String(items.length) })}
        </span>
        {loaded.cursor ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`?state=${loaded.state}&cursor=${encodeURIComponent(loaded.cursor)}`}>
              {t("common.next")}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type Item = Awaited<ReturnType<typeof loader>>["items"][number];

function ApprovalCard({
  item,
  locale,
  l,
  t,
  busy,
  deciding,
  problem
}: {
  item: Item;
  locale: string;
  l: (key: string) => string;
  t: (key: string, vars?: Record<string, string>) => string;
  busy: boolean;
  deciding: FormDataEntryValue | null | undefined;
  problem: { title: string; detail?: string } | null;
}) {
  const pending = item.decision === "pending";
  const mine = deciding === item.id;
  // Dual control refuses the initiator's own decision (packages/core §decide).
  // The buttons go, the evidence stays: they still need to read it to know who
  // to chase.
  const blocked = pending && item.dualControl && item.selfRaised;
  const [reason, setReason] = useState("");
  const [needsReason, setNeedsReason] = useState(false);

  return (
    <Card
      elevation="flat"
      title={<span className="font-mono text-14">{item.policyKey}</span>}
      description={item.subject.text}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {item.agentRaised ? (
            // The single ✦ (docs/01 §7). ponytail: AgentBadge carries its own
            // English copy, so the marker is used with a label from the table
            // above rather than shipping "AI-generated" into an Arabic page.
            <Badge tone="accent" size="sm">
              <span aria-hidden="true">{AGENT_MARK}</span>
              <span>{l("agent")}</span>
            </Badge>
          ) : null}
          <Badge tone={toneFor(item.decision)} size="sm" dot>
            {l(`state.${item.decision}`)}
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Entry term={l("module")}>{item.module}</Entry>
          {/* What is actually being changed. A create has no row to open yet,
              and a hand-written engine's subject has no generic screen — both
              say so rather than offering a link that goes nowhere. */}
          <Entry term={l("subject")}>
            {item.subject.unborn ? (
              <span className="text-subtle">{l("subjectNew")}</span>
            ) : item.subject.href ? (
              <Link
                to={item.subject.href}
                className="font-mono text-12 break-all text-accent underline-offset-2 hover:underline"
              >
                {item.subject.text}
              </Link>
            ) : (
              <span className="font-mono text-12 break-all">{item.subject.text}</span>
            )}
          </Entry>
          <Entry term={l("requestedBy")}>
            <span className="font-mono text-12">{item.requestedBy}</span>
          </Entry>
          <Entry term={l("amount")}>
            {item.amountMinor === null ? (
              "—"
            ) : item.currency ? (
              <Money amountMinor={item.amountMinor} currency={item.currency} locale={locale} />
            ) : (
              // No currency anywhere is a gap in the request, not a licence to
              // print a bare number as money (docs/22 §5.1).
              <span className="tabular-nums">{item.amountMinor}</span>
            )}
          </Entry>
          <Entry term={l("requested")}>
            <DateTime value={item.requestedAt} locale={locale} precision="minute" />
          </Entry>
          <Entry term={l("expires")}>
            {item.expiresAt === null ? (
              l("expiresOnDecision")
            ) : (
              <DateTime value={item.expiresAt} locale={locale} precision="minute" />
            )}
          </Entry>
          <Entry term={l("control")}>
            {item.dualControl ? l("dualControl") : l("singleControl")}
          </Entry>
          {item.decidedBy ? (
            <Entry term={l("decidedBy")}>
              <span className="font-mono text-12">{item.decidedBy}</span>
            </Entry>
          ) : null}
          {item.decidedAt ? (
            <Entry term={l("decidedAt")}>
              <DateTime value={item.decidedAt} locale={locale} precision="minute" />
            </Entry>
          ) : null}
          {item.reason ? <Entry term={l("reason")}>{item.reason}</Entry> : null}
        </dl>

        {item.why.length ? (
          <section className="rounded-md border border-border bg-surface-2 p-3">
            <h3 className="font-ui text-12 text-subtle">{l("why")}</h3>
            <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {item.why.map((entry) => (
                <Entry key={entry.key} term={entry.key}>
                  {entry.minor !== null && item.currency ? (
                    <Money amountMinor={entry.minor} currency={item.currency} locale={locale} />
                  ) : (
                    entry.text
                  )}
                </Entry>
              ))}
            </dl>
          </section>
        ) : null}

        {item.run ? (
          <p className="font-ui text-12">
            <Link
              to={`/admin/ai/console?run=${encodeURIComponent(item.run.id)}`}
              className="text-accent underline-offset-2 hover:underline"
            >
              {l("openRun")} — <span className="font-mono">{item.run.agentKey}</span>
            </Link>
          </p>
        ) : null}

        {/* The API's own words, on the request that earned them. */}
        {problem ? <Problem problem={problem} /> : null}

        {blocked ? (
          <p role="note" className="border-t border-border pt-4 font-ui text-13 text-subtle">
            {l("selfRaised")}
          </p>
        ) : pending ? (
          <Form
            method="post"
            className="flex flex-col gap-3 border-t border-border pt-4"
            onSubmit={(event) => {
              const submitter = (event.nativeEvent as SubmitEvent).submitter as
                | HTMLButtonElement
                | null;
              if (submitter?.value !== "reject") return;
              // Both rules the API applies to a rejection, asked before the
              // round trip rather than instead of it: the reason it requires,
              // and the fact that nothing undoes this afterwards.
              setNeedsReason(!reason.trim());
              if (!reason.trim() || !confirm(l("confirmReject"))) event.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={item.id} />
            <Field
              label={l("reason")}
              hint={l("reasonHint")}
              {...(needsReason && !reason.trim() ? { error: l("reasonRequired") } : {})}
            >
              {/* Not `required`: the field is optional for an approval, and only
                  the reject path needs it. The rule still lives in the API — the
                  check above is a courtesy, not a copy that could drift. */}
              <Textarea
                name="reason"
                rows={2}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="approve" loading={mine} disabled={busy}>
                {l("approve")}
              </Button>
              <Button
                type="submit"
                name="intent"
                value="reject"
                variant="danger"
                loading={mine}
                disabled={busy}
              >
                {l("reject")}
              </Button>
            </div>
          </Form>
        ) : null}
      </div>
      <span className="sr-only">{t("common.id")}: {item.id}</span>
    </Card>
  );
}

function Entry({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-ui text-12 text-subtle">{term}</dt>
      <dd className="font-ui text-13 text-text">{children}</dd>
    </div>
  );
}
