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
  AGENT_MARK,
  Badge,
  Button,
  Card,
  DateTime,
  EmptyState,
  EvidenceLink,
  KPIWall,
  Money,
  Stat,
  Table,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { cloudflare } from "../context";
import { pseudoText } from "../i18n";
import { Gate } from "./staff";
import { ORBIT, daysUntil, safe, type Page } from "./orbit-shared";

// D.7: the AXIS operator view of orbit_renewals — a read of the same table
// orbit-save.tsx writes, joined to the policy head it renews. Two of its four
// intents (requote, lapse-intent) are the same PATCH orbit-save already makes;
// bind-renewal is the one-tap POST /v1/axis/policies/:id/renew (server derives
// its own idempotency key, same as endorse/cancel); offer is a link into
// ORBIT's save desk, not a write — "ORBIT sends it, AXIS does not" (spec).

export const PERM = {
  read: ORBIT.renewals,
  write: ORBIT.renewalsWrite,
  policyRead: "axis:policies:read",
  renew: "axis:policies:renew"
} as const;

/* --------------------------------------------------------------- contract */

export interface Renewal {
  id: string;
  policyRef: string | null;
  customerId: string | null;
  expiryAt: number | null;
  churnScore: number | null;
  strategy: string;
  state: string;
  outcomeReason: string | null;
  ownerRef: string | null;
  offeredAt: number | null;
  decidedAt: number | null;
  requotesJson: unknown;
  createdAt: number;
}

export interface PolicyHead {
  id: string;
  policyNo: string;
  customerId: string | null;
  grossMinor: number;
  currency: string;
}

export interface Row {
  renewal: Renewal;
  policy: PolicyHead | null;
}

/* ------------------------------------------------------------------ labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Renewal desk",
    // No requote engine writes orbit_renewals.requotes_json yet, so this desk
    // shows the current gross and no re-quoted price — the intro must not
    // promise a column that does not exist.
    intro: "Terms expiring in the next 60 days, their churn risk, and the one-tap bind.",
    empty: "No terms expiring in the next 60 days.",
    count: "Expiring",
    holder: "Holder",
    expires: "Expires",
    daysLeft: "Days left",
    currentGross: "Current gross",
    risk: "Churn risk",
    strategy: "Strategy",
    owner: "Owner",
    act: "Action",
    requote: "Auto re-quote",
    offer: "Open in save desk",
    bindRenewal: "Bind renewal",
    lapse: "Do not contact",
    working: "Working",
    saved: "Recorded.",
    auto_requote: "Auto re-quote",
    human: "Handled by a person",
    do_not_contact: "Do not contact",
    riskWhy: "Why this score",
    riskWhyBody:
      "The churn score is written by the retention model on the renewal record. It is a ranking aid, not a decision.",
    "problem.missing_renewal": "Pick a renewal first.",
    "problem.missing_policy": "Pick a policy first.",
    "problem.unknown_intent": "That control is not available."
  },
  ar: {
    title: "مكتب التجديد",
    intro: "الوثائق التي تنتهي خلال 60 يومًا القادمة، وخطر تسربها، والتجديد بلمسة واحدة.",
    empty: "لا توجد وثائق تنتهي خلال 60 يومًا القادمة.",
    count: "على وشك الانتهاء",
    holder: "حامل الوثيقة",
    expires: "تنتهي",
    daysLeft: "الأيام المتبقية",
    currentGross: "الإجمالي الحالي",
    risk: "خطر التسرب",
    strategy: "الأسلوب",
    owner: "المسؤول",
    act: "إجراء",
    requote: "إعادة تسعير تلقائية",
    offer: "افتح في مكتب الاستبقاء",
    bindRenewal: "تجديد الوثيقة",
    lapse: "عدم التواصل",
    working: "جارٍ التنفيذ",
    saved: "تم التسجيل.",
    auto_requote: "إعادة تسعير تلقائية",
    human: "يتولاها موظف",
    do_not_contact: "عدم التواصل",
    riskWhy: "سبب هذه الدرجة",
    riskWhyBody: "درجة التسرب يكتبها نموذج الاستبقاء على سجل التجديد. هي مساعدة في الترتيب وليست قرارًا.",
    "problem.missing_renewal": "اختر تجديدًا أولًا.",
    "problem.missing_policy": "اختر وثيقة أولًا.",
    "problem.unknown_intent": "هذا الإجراء غير متاح."
  }
};

export type Label = (key: string, vars?: Record<string, string>) => string;

export function labelsIn(locale: string): Label {
  return (key, vars) => {
    const raw = pseudoText(locale, LABELS[locale]?.[key] ?? LABELS.en?.[key] ?? key);
    return vars ? raw.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole) : raw;
  };
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const empty: Page<Renewal> = { data: [] };

  const list = (query: string) =>
    held.has(PERM.read) ? safe(() => api<Page<Renewal>>(`/v1/orbit/renewals?${query}`, opts), empty) : Promise.resolve(empty);

  const [scheduled, offered] = await Promise.all([
    list("state=scheduled&sort=expiryAt&order=asc&limit=50"),
    list("state=offered&sort=expiryAt&order=asc&limit=50")
  ]);

  const renewals = [...scheduled.data, ...offered.data].sort((a, b) => (a.expiryAt ?? 0) - (b.expiryAt ?? 0));

  const rows: Row[] = await Promise.all(
    renewals.map(async (renewal) => {
      if (!held.has(PERM.policyRead) || !renewal.policyRef) return { renewal, policy: null };
      const policy = await safe(() => api<PolicyHead>(`/v1/axis/policies/${renewal.policyRef}`, opts), null);
      return { renewal, policy };
    })
  );

  return {
    locale: me.locale,
    now: Date.now(),
    nonce: crypto.randomUUID(),
    may: { read: held.has(PERM.read), write: held.has(PERM.write), bind: held.has(PERM.renew) },
    rows
  };
}

/* ------------------------------------------------------------------ action */

export interface Refusal {
  title: string;
  status: number;
  code?: string;
  detail?: string;
}

export interface ActionResult {
  problem: Refusal | null;
  saved: string | null;
}

const refuse = (code: string, status = 400): ActionResult => ({
  problem: { title: code, status, code },
  saved: null
});

export async function action({ request, context }: ActionFunctionArgs): Promise<ActionResult> {
  const env = context.get(cloudflare).env;
  const opts = { env, request };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    if (intent === "requote" || intent === "lapse-intent") {
      if (!id) return refuse("missing_renewal");
      await api(`/v1/orbit/renewals/${id}`, {
        ...opts,
        method: "PATCH",
        headers: { "idempotency-key": String(form.get("nonce") ?? crypto.randomUUID()) },
        body: { strategy: intent === "requote" ? "auto_requote" : "do_not_contact" }
      });
      return { problem: null, saved: id };
    }

    if (intent === "bind-renewal") {
      if (!id) return refuse("missing_policy");
      await api(`/v1/axis/policies/${id}/renew`, { ...opts, method: "POST", body: {} });
      return { problem: null, saved: id };
    }
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, saved: null };
    throw error;
  }

  return refuse("unknown_intent");
}

export function phrase(problem: Refusal, l: Label): Refusal {
  const key = `problem.${problem.code ?? ""}`;
  const text = l(key);
  return text === key ? problem : { ...problem, title: text };
}

/* --------------------------------------------------------------- component */

export default function RenewalDesk() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const l = labelsIn(loaded.locale);
  const busy = navigation.state === "submitting";

  if (!loaded.may.read) {
    return <EmptyState title={l("title")} body={l("empty")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-22 leading-[1.2] text-text">{l("title")}</h1>
        <p className="font-ui text-13 text-muted">{l("intro")}</p>
      </header>

      {result?.problem ? <Gate problem={phrase(result.problem, l)} l={l} /> : null}
      {result?.saved ? (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 p-3">
          <p className="font-ui text-13 text-text">{l("saved")}</p>
        </div>
      ) : null}

      <KPIWall>
        <Stat label={l("count")} value={String(loaded.rows.length)} />
      </KPIWall>

      <Card title={l("title")} description={l("intro")}>
        {loaded.rows.length === 0 ? (
          <EmptyState title={l("empty")} body={l("intro")} />
        ) : (
          <Table
            caption={l("title")}
            rows={loaded.rows}
            rowKey={(row) => row.renewal.id}
            columns={
              [
                {
                  key: "holder",
                  header: l("holder"),
                  render: (row) => (
                    <div className="flex flex-col">
                      <Link
                        to={`/axis/policies/${row.policy?.id ?? ""}/detail`}
                        className="font-ui text-13 text-accent underline underline-offset-2"
                      >
                        {row.policy?.policyNo ?? row.renewal.customerId ?? row.renewal.id}
                      </Link>
                      <span className="font-mono text-12 text-subtle">{row.renewal.policyRef ?? ""}</span>
                    </div>
                  )
                },
                {
                  key: "expiryAt",
                  header: l("expires"),
                  render: (row) =>
                    row.renewal.expiryAt ? (
                      <DateTime value={row.renewal.expiryAt} locale={loaded.locale} precision="day" />
                    ) : (
                      "—"
                    )
                },
                {
                  key: "daysLeft",
                  header: l("daysLeft"),
                  numeric: true,
                  render: (row) => {
                    const days = daysUntil(row.renewal.expiryAt, loaded.now);
                    if (days === null) return "—";
                    return (
                      <span className={days <= 7 ? "font-ui text-13 font-medium text-danger" : "font-ui text-13 text-text"}>
                        {days}
                      </span>
                    );
                  }
                },
                {
                  key: "currentGross",
                  header: l("currentGross"),
                  numeric: true,
                  render: (row) =>
                    row.policy ? (
                      <Money amountMinor={row.policy.grossMinor} currency={row.policy.currency} locale={loaded.locale} />
                    ) : (
                      "—"
                    )
                },
                {
                  key: "risk",
                  header: l("risk"),
                  numeric: true,
                  render: (row) => (
                    <EvidenceLink
                      sourceLabel={l("riskWhy")}
                      source={<p className="font-ui text-13 text-muted">{l("riskWhyBody")}</p>}
                    >
                      <Badge tone={(row.renewal.churnScore ?? 0) >= 65 ? "warning" : "success"}>
                        <span aria-hidden="true">{AGENT_MARK}</span>
                        <span>{row.renewal.churnScore ?? "—"}</span>
                      </Badge>
                    </EvidenceLink>
                  )
                },
                {
                  key: "strategy",
                  header: l("strategy"),
                  render: (row) => <Badge>{l(row.renewal.strategy)}</Badge>
                },
                {
                  key: "owner",
                  header: l("owner"),
                  render: (row) => row.renewal.ownerRef ?? "—"
                },
                {
                  key: "act",
                  header: l("act"),
                  render: (row) => (
                    <div className="flex flex-wrap items-center gap-2">
                      {loaded.may.write ? (
                        <>
                          <Form method="post">
                            <input type="hidden" name="intent" value="requote" />
                            <input type="hidden" name="id" value={row.renewal.id} />
                            <input type="hidden" name="nonce" value={`requote:${loaded.nonce}:${row.renewal.id}`} />
                            <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                              {busy ? l("working") : l("requote")}
                            </Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="lapse-intent" />
                            <input type="hidden" name="id" value={row.renewal.id} />
                            <Button type="submit" size="sm" variant="ghost" disabled={busy}>
                              {l("lapse")}
                            </Button>
                          </Form>
                        </>
                      ) : null}
                      <Link to={`/orbit/save`} className="font-ui text-13 text-accent underline underline-offset-2">
                        {l("offer")}
                      </Link>
                      {loaded.may.bind && row.policy ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="bind-renewal" />
                          <input type="hidden" name="id" value={row.policy.id} />
                          <Button type="submit" size="sm" disabled={busy}>
                            {busy ? l("working") : l("bindRenewal")}
                          </Button>
                        </Form>
                      ) : null}
                    </div>
                  )
                }
              ] satisfies Column<Row>[]
            }
          />
        )}
      </Card>
    </div>
  );
}
