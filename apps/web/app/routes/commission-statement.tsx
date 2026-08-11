import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Money,
  PageHeader,
  Select,
  Table,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe, names } from "../api.server";
import { who } from "../names";
import { Cell, FieldInput, toneFor } from "../components/fields";
import { cloudflare } from "../context";
import { pseudoText, translator } from "../i18n";
import { vocabulary } from "../modules/vocabulary";
import { bodyFrom, optionLabel, type FieldSpec, type Row } from "../modules/spec";
import { Problem } from "./module";
import { useShellData } from "./workspace";

// The commission position, from the entries themselves: what was written, what
// each counterparty owes, and what is left after the channel is paid. The
// generic list can show the same rows but cannot add them up, and a commission
// screen that shows rows without a total is a spreadsheet export with extra
// steps.
//
// Two writes live here because they are the only two the API allows on an
// entry: accruing one from an issued policy, and reversing one. Neither is a
// PATCH — money is written by a transition, never by editing a column
// (CLAUDE.md §12).

/* --------------------------------------------------------------- contract */

/** Exactly as apps/api/src/routes/dist.ts spells them on these handlers. */
const PERM = {
  read: "dist:commissions:read",
  adjust: "dist:commissions:adjust"
} as const;

/** The commission entry row, as the API returns it (packages/db schema/dist). */
export interface CommissionEntry {
  id: string;
  policyId: string;
  offeringId: string | null;
  providerId: string;
  channelId: string;
  kind: string;
  premiumMinor: number;
  grossCommissionMinor: number;
  channelCommissionMinor: number;
  netCommissionMinor: number;
  taxMinor: number;
  currency: string;
  earnedOn: string;
  earnedAt: number | null;
  state: string;
  reversalOf: string | null;
  providerSettlementId: string | null;
  channelSettlementId: string | null;
  txnId: string | null;
  createdAt: number;
}

/** One currency's position. The API groups by currency because adding AED to
 *  USD produces a number that means nothing (docs/22 §5.1). */
export interface CurrencyTotals {
  currency: string;
  count: number;
  premiumMinor: number;
  receivableMinor: number;
  payableMinor: number;
  netMinor: number;
  taxMinor: number;
}

/** `GET /v1/dist/commission-entries/statement`. */
interface Statement {
  /** Every matching entry, grouped — not just the page in `entries`. */
  totals: CurrencyTotals[];
  count: number;
  limit: number;
  entries: CommissionEntry[];
}

/** The only filters the statement handler applies. Anything else is ignored
 *  server-side, so offering it here would be a lie. */
export const FILTER_KEYS = ["providerId", "channelId", "state"] as const;

const STATES = [
  "accrued",
  "invoiced",
  "received",
  "payable",
  "paid",
  "clawed_back",
  "disputed",
  "written_off"
] as const;

/** `POST /commission-entries/accrue` — AccrueBody, field for field. */
const ACCRUE_FIELDS: readonly FieldSpec[] = [
  { name: "policyId", type: "text", required: true, hintKey: "policyIdHint" },
  {
    name: "kind",
    type: "select",
    options: ["new_business", "renewal", "endorsement", "adjustment"]
  },
  { name: "earnedOn", type: "select", options: ["issue", "collection"] },
  { name: "taxMinor", type: "money", hintKey: "taxMinorHint" }
];

/** Totals, in the order a commission statement reads: what was sold, what it
 *  earns, what it costs, and what is left. */
const TOTAL_KEYS = ["premiumMinor", "receivableMinor", "payableMinor", "taxMinor"] as const;

/* ------------------------------------------------------------------ labels */

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Commission statement",
    intro:
      "Every commission entry that matches these filters, and the position they add up to. Figures are the entries themselves — nothing here is an estimate.",
    backToEntries: "Back to commission entries",
    filters: "Filters",
    providerId: "Provider",
    channelId: "Channel",
    state: "State",
    apply: "Apply filters",
    clear: "Clear filters",
    results: "Commission entries",
    totals: "Position",
    premiumMinor: "Premium written",
    receivableMinor: "Receivable from providers",
    payableMinor: "Payable to channels",
    taxMinor: "Tax",
    netMinor: "Net commission",
    netHint: "Receivable less channel payable and tax.",
    policyId: "Policy",
    kind: "Kind",
    earnedOn: "Earned on",
    premium: "Premium",
    gross: "Gross",
    channel: "Channel share",
    net: "Net",
    earnedAt: "Earned",
    notEarned: "Not yet earned",
    paged:
      "The {shown} most recent are listed. The position below covers every matching entry, not only these.",
    emptyTitle: "No commission has been accrued yet",
    emptyBody: "Entries appear here once a policy is accrued against the rate in force.",
    filteredTitle: "No entries match these filters",
    filteredBody: "Clear the filters to see the whole position.",
    deniedTitle: "You cannot read commission",
    accrue: "Accrue commission",
    accrueIntro:
      "Rates the policy against the commission rate in force and writes the entry. The amounts are derived, never typed — a channel cannot post its own commission.",
    policyIdHint: "The issued policy to rate.",
    taxMinorHint: "Withheld tax. Leave empty for none.",
    accrued: "Accrued against policy {policy}.",
    accruedGross: "Gross",
    openEntry: "Open the entry",
    clawback: "Claw back",
    clawbackFor: "Claw back the entry for policy {policy}",
    reversed: "Reversed",
    reversal: "Reversal",
    "kind.new_business": "New business",
    "kind.renewal": "Renewal",
    "kind.endorsement": "Endorsement",
    "kind.clawback": "Clawback",
    "kind.adjustment": "Adjustment",
    "earnedOn.issue": "On issue",
    "earnedOn.collection": "On collection",
    "state.accrued": "Accrued",
    "state.invoiced": "Invoiced",
    "state.received": "Received",
    "state.payable": "Payable",
    "state.paid": "Paid",
    "state.clawed_back": "Clawed back",
    "state.disputed": "Disputed",
    "state.written_off": "Written off"
  },
  ar: {
    title: "كشف العمولات",
    intro:
      "كل قيود العمولة المطابقة لهذه المرشحات، والمركز الذي تصل إليه. الأرقام هي القيود نفسها — لا شيء هنا تقديري.",
    backToEntries: "العودة إلى قيود العمولة",
    filters: "المرشحات",
    providerId: "المزود",
    channelId: "القناة",
    state: "الوضع",
    apply: "تطبيق المرشحات",
    clear: "مسح المرشحات",
    results: "قيود العمولة",
    totals: "المركز",
    premiumMinor: "الأقساط المكتتبة",
    receivableMinor: "مستحق من المزودين",
    payableMinor: "مستحق للقنوات",
    taxMinor: "الضريبة",
    netMinor: "صافي العمولة",
    netHint: "المستحق ناقص حصة القناة والضريبة.",
    policyId: "الوثيقة",
    kind: "النوع",
    earnedOn: "الاستحقاق",
    premium: "القسط",
    gross: "الإجمالي",
    channel: "حصة القناة",
    net: "الصافي",
    earnedAt: "تاريخ الاستحقاق",
    notEarned: "لم يستحق بعد",
    paged: "معروض أحدث {shown} قيد. المركز أدناه يشمل كل القيود المطابقة وليس المعروضة فقط.",
    emptyTitle: "لم تُستحق أي عمولة بعد",
    emptyBody: "تظهر القيود هنا بعد احتساب وثيقة وفق السعر الساري.",
    filteredTitle: "لا توجد قيود مطابقة لهذه المرشحات",
    filteredBody: "امسح المرشحات لعرض المركز كاملًا.",
    deniedTitle: "لا يمكنك قراءة العمولات",
    accrue: "احتساب عمولة",
    accrueIntro:
      "يحتسب الوثيقة وفق سعر العمولة الساري ويكتب القيد. المبالغ مشتقة ولا تُكتب يدويًا — لا يمكن لقناة أن تسجل عمولتها بنفسها.",
    policyIdHint: "الوثيقة الصادرة المراد احتسابها.",
    taxMinorHint: "الضريبة المستقطعة. اتركه فارغًا إن لم توجد.",
    accrued: "تم الاحتساب على الوثيقة {policy}.",
    accruedGross: "الإجمالي",
    openEntry: "فتح القيد",
    clawback: "استرداد",
    clawbackFor: "استرداد قيد الوثيقة {policy}",
    reversed: "معكوس",
    reversal: "قيد عكسي",
    "kind.new_business": "أعمال جديدة",
    "kind.renewal": "تجديد",
    "kind.endorsement": "ملحق",
    "kind.clawback": "استرداد",
    "kind.adjustment": "تسوية",
    "earnedOn.issue": "عند الإصدار",
    "earnedOn.collection": "عند التحصيل",
    "state.accrued": "مستحق",
    "state.invoiced": "مفوتر",
    "state.received": "مستلم",
    "state.payable": "واجب الدفع",
    "state.paid": "مدفوع",
    "state.clawed_back": "تم استرداده",
    "state.disputed": "متنازع عليه",
    "state.written_off": "مشطوب"
  }
};

/**
 * The domain pack first (CLAUDE.md §14 — `policyId` is an industry noun), then
 * the local table, then the shared `common.*` catalogue, then the raw key.
 */
export function labelsIn(
  locale: string,
  pack?: string
): (key: string, vars?: Record<string, string>) => string {
  const table = LABELS[locale] ?? LABELS.en ?? {};
  const fallback = LABELS.en ?? {};
  const packed = vocabulary(pack, locale);
  const t = translator(locale);
  return (key, vars) => {
    const local = packed(key) ?? table[key] ?? fallback[key];
    // `t()` pseudoizes on its own; only the route's own table needs the wrap.
    const shared = local === undefined ? t(`common.${key}`) : pseudoText(locale, local);
    const raw = shared === `common.${key}` ? key : shared;
    return vars ? raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match) : raw;
  };
}

/* ------------------------------------------------------------------- rules */

/** The filters the statement handler honours, and only those. */
export function filtersFrom(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Whether this entry may be reversed. The API refuses a reversal of a reversal
 * (409) but not a second reversal of the same accrual, which would write the
 * negative twice — so the already-reversed check lives here as well.
 */
export function canClawBack(
  entry: Pick<CommissionEntry, "reversalOf" | "state">,
  mayAdjust: boolean
): boolean {
  return mayAdjust && entry.reversalOf === null && entry.state !== "clawed_back";
}

/**
 * One currency's totals as a row `Cell` can render: minor units untouched, with
 * the currency alongside so money never renders as a bare integer (docs/22 §5.1).
 */
export function totalsRow(totals: CurrencyTotals): Row {
  return { ...totals, __currency: totals.currency };
}

/* ------------------------------------------------------------------ loader */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const filters = filtersFrom(new URL(request.url));

  // The shell's copy of the actor's permissions is browser-only, so this screen
  // asks for its own and then makes only the calls the actor may make.
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);
  const may = { read: held.has(PERM.read), adjust: held.has(PERM.adjust) };
  // Minted per render, not per click: a double submit is then the same accrual
  // twice, which the API deduplicates, rather than two entries (CLAUDE.md §12).
  const idempotencyKey = crypto.randomUUID();

  if (!may.read) return { may, filters, statement: null, names: {}, idempotencyKey };

  const query = new URLSearchParams(filters).toString();
  try {
    const statement = await api<Statement>(
      `/v1/dist/commission-entries/statement${query ? `?${query}` : ""}`,
      { env, request }
    );
    // A statement line points at its agreement by id; the policy number is what
    // a broker reconciles against, and it is one batch call away.
    const resolved = await names(
      statement.entries.flatMap((entry) => [entry.policyId, entry.providerId, entry.channelId]),
      { env, request }
    );
    return { may, filters, statement, names: resolved, idempotencyKey };
  } catch (error) {
    // A grant can be revoked between /v1/me and this call; that is a notice,
    // never a blank screen.
    if (error instanceof ApiError && error.status === 403) {
      return { may: { ...may, read: false }, filters, statement: null, names: {}, idempotencyKey };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ action */

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "accrue") {
    return { problem: { title: "unknown intent", status: 400 }, accrued: null };
  }

  const key = String(form.get("idempotencyKey") ?? "");
  try {
    const accrued = await api<CommissionEntry>("/v1/dist/commission-entries/accrue", {
      env,
      request,
      method: "POST",
      ...(key ? { headers: { "idempotency-key": key } } : {}),
      body: bodyFrom(ACCRUE_FIELDS, form)
    });
    return { problem: null, accrued };
  } catch (error) {
    // "already accrued", "policy has no offering to rate" and a refused
    // permission are all answers, not crashes: they belong beside the form.
    if (error instanceof ApiError) return { problem: error.problem, accrued: null };
    throw error;
  }
}

/* --------------------------------------------------------------- component */

export default function CommissionStatement() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const location = useLocation();

  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelsIn(locale, shell?.domainPack);
  const busy = navigation.state !== "idle";

  const statement = loaded.statement;
  if (!statement) {
    return (
      <div className="flex flex-col gap-6">
        <Header l={l} />
        <EmptyState title={l("deniedTitle")} body={t("error.forbidden")} />
      </div>
    );
  }

  const entries = statement.entries;
  const filtered = Object.keys(loaded.filters).length > 0;
  const accrued = result?.accrued ?? null;

  const columns: Array<Column<CommissionEntry>> = [
    {
      key: "policyId",
      header: l("policyId"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <Link
            to={`/distribution/commission-entries/${row.id}`}
            className="font-ui text-12 text-accent underline-offset-2 hover:underline"
          >
            {who(row.policyId, loaded.names)}
          </Link>
          {/* The carrier read `pv_01KE…H8PQ` under every policy number; the
              catalogue resolves for any signed-in actor (ADR-0048). */}
          <span className="text-12 text-subtle">{who(row.providerId, loaded.names)}</span>
        </span>
      )
    },
    {
      key: "kind",
      header: l("kind"),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <span>{optionLabel(l, "kind", row.kind)}</span>
          {row.reversalOf ? (
            <Badge tone="danger" size="sm">
              {l("reversal")}
            </Badge>
          ) : null}
        </span>
      )
    },
    money("premiumMinor", l("premium"), locale, l),
    money("grossCommissionMinor", l("gross"), locale, l),
    money("channelCommissionMinor", l("channel"), locale, l),
    money("netCommissionMinor", l("net"), locale, l),
    {
      key: "state",
      header: l("state"),
      render: (row) => (
        <Badge tone={toneFor(row.state)} size="sm" dot>
          {optionLabel(l, "state", row.state)}
        </Badge>
      )
    },
    {
      key: "earnedAt",
      header: l("earnedAt"),
      render: (row) =>
        row.earnedAt === null ? (
          // Earned on collection: the entry exists, the money has not been
          // earned. A dash would read as missing data.
          <span className="font-ui text-12 text-subtle">{l("notEarned")}</span>
        ) : (
          <Cell
            column={{ name: "earnedAt", type: "date" }}
            row={row as unknown as Row}
            locale={locale}
            label={l}
          />
        )
    }
  ];

  // Withheld is absent, not disabled: without `dist:commissions:adjust` the
  // column does not exist at all.
  if (loaded.may.adjust) {
    columns.push({
      key: "clawback",
      header: t("common.actions"),
      render: (row) =>
        canClawBack(row, true) ? (
          <Link
            to={`/distribution/commission-entries/${row.id}/clawback`}
            aria-label={l("clawbackFor", { policy: row.policyId })}
            className="font-ui text-12 text-accent underline-offset-2 hover:underline"
          >
            {l("clawback")}
          </Link>
        ) : (
          <span className="font-ui text-12 text-subtle">
            {row.state === "clawed_back" ? l("reversed") : "—"}
          </span>
        )
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Header l={l} />

      <Form method="get" className="flex flex-wrap items-end gap-3" aria-label={l("filters")}>
        <Input
          name="providerId"
          defaultValue={loaded.filters.providerId ?? ""}
          aria-label={l("providerId")}
          placeholder={l("providerId")}
          className="w-56"
        />
        <Input
          name="channelId"
          defaultValue={loaded.filters.channelId ?? ""}
          aria-label={l("channelId")}
          placeholder={l("channelId")}
          className="w-56"
        />
        <Select
          name="state"
          aria-label={l("state")}
          defaultValue={loaded.filters.state ?? ""}
          placeholder={l("state")}
          options={[
            { value: "", label: t("common.all") },
            ...STATES.map((state) => ({ value: state, label: l(`state.${state}`) }))
          ]}
        />
        <Button type="submit" variant="secondary" size="sm" loading={busy}>
          {l("apply")}
        </Button>
        {filtered ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={location.pathname}>{l("clear")}</Link>
          </Button>
        ) : null}
      </Form>

      <div aria-busy={busy}>
        {entries.length === 0 ? (
          <EmptyState
            title={filtered ? l("filteredTitle") : l("emptyTitle")}
            body={filtered ? l("filteredBody") : l("emptyBody")}
          />
        ) : (
          <Table
            columns={columns}
            rows={entries}
            rowKey={(row) => row.id}
            caption={l("results")}
            density="compact"
            stickyHeader
            footer={
              <div className="flex flex-col gap-4 pt-3">
                <p className="font-ui text-12 tabular-nums text-subtle">
                  {t("common.rows", { count: String(statement.count) })}
                  {/* The listed entries are a page; the position under them is
                      the whole matching set, so the two counts can differ. */}
                  {entries.length < statement.count
                    ? ` · ${l("paged", { shown: String(entries.length) })}`
                    : ""}
                </p>
                {statement.totals.map((totals) => (
                  <section key={totals.currency} className="flex flex-col gap-2">
                    {/* Each currency stands alone: a statement that adds AED to
                        USD is a number nobody can act on (docs/22 §5.1). */}
                    {statement.totals.length > 1 ? (
                      <h3 className="font-mono text-12 tracking-wide text-subtle">
                        {totals.currency}
                      </h3>
                    ) : null}
                    <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                      {TOTAL_KEYS.map((key) => (
                        <div key={key} className="flex flex-col gap-0.5">
                          <dt className="font-ui text-12 text-subtle">{l(key)}</dt>
                          <dd className="font-ui text-13 text-text">
                            <Cell
                              column={{ name: key, type: "money", currencyFrom: "__currency" }}
                              row={totalsRow(totals)}
                              locale={locale}
                              label={l}
                            />
                          </dd>
                        </div>
                      ))}
                      {/* Net is the figure the statement exists to produce, so it
                          carries the weight rather than sitting fourth among equals. */}
                      <div className="flex flex-col gap-0.5">
                        <dt className="font-ui text-12 text-subtle">{l("netMinor")}</dt>
                        <dd className="font-mono text-22 tabular-nums text-text">
                          <Money
                            amountMinor={totals.netMinor}
                            currency={totals.currency}
                            locale={locale}
                            toned
                          />
                        </dd>
                        <dd className="font-ui text-12 text-subtle">{l("netHint")}</dd>
                      </div>
                    </dl>
                  </section>
                ))}
              </div>
            }
          />
        )}
      </div>

      {loaded.may.adjust ? (
        <section aria-labelledby="accrue-heading" className="flex flex-col gap-3">
          <h2 id="accrue-heading" className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">
            {l("accrue")}
          </h2>
          <p className="max-w-prose font-ui text-13 text-muted">{l("accrueIntro")}</p>

          {result?.problem ? <Problem problem={result.problem} /> : null}
          {accrued ? (
            <p
              role="status"
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-surface-2 p-3 font-ui text-13 text-text"
            >
              <span>{l("accrued", { policy: accrued.policyId })}</span>
              <span className="text-subtle">{l("accruedGross")}</span>
              <Money
                amountMinor={accrued.grossCommissionMinor}
                currency={accrued.currency}
                locale={locale}
              />
              <Link
                to={`/distribution/commission-entries/${accrued.id}`}
                className="text-accent underline-offset-2 hover:underline"
              >
                {l("openEntry")}
              </Link>
            </p>
          ) : null}

          <Form method="post" className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <input type="hidden" name="intent" value="accrue" />
            <input type="hidden" name="idempotencyKey" value={loaded.idempotencyKey} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ACCRUE_FIELDS.map((field) => (
                <FieldInput key={field.name} field={field} label={l} />
              ))}
            </div>
            <div>
              <Button type="submit" loading={busy}>
                {l("accrue")}
              </Button>
            </div>
          </Form>
        </section>
      ) : null}
    </div>
  );
}

function Header({ l }: { l: (key: string, vars?: Record<string, string>) => string }) {
  return (
    <PageHeader
      title={l("title")}
      description={l("intro")}
      back={
        <Link
          to="/distribution/commission-entries"
          className="font-ui text-12 text-subtle underline-offset-2 hover:underline"
        >
          {l("backToEntries")}
        </Link>
      }
    />
  );
}

/** A money column, rendered by the one component that knows what money is. */
function money(
  name: keyof CommissionEntry,
  header: string,
  locale: string,
  label: (key: string) => string
): Column<CommissionEntry> {
  return {
    key: name,
    header,
    numeric: true,
    render: (row) => (
      <Cell
        column={{ name, type: "money", currencyFrom: "currency" }}
        row={row as unknown as Row}
        locale={locale}
        label={label}
      />
    )
  };
}
