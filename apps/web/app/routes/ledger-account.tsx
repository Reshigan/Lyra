import { Form, Link, useLoaderData, useNavigation, type LoaderFunctionArgs } from "react-router";
import { Badge, Button, Card, DateTime, EmptyState, Field, Input, Money, Table, type Column } from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { useShellData } from "./workspace";
import { PERM, labelIn } from "./ledger.shared";

// Read-only by design: an account balance is an outcome, never an input. The
// only thing worth alarming about here is the cached balance disagreeing with
// the journal it is derived from.

interface StatementLine {
  batchId: string;
  txnId: string | null;
  seq: number;
  side: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
  postedAt: number;
  runningMinor: number;
}

interface Statement {
  accountCode: string;
  openingMinor: number;
  closingMinor: number;
  lines: StatementLine[];
}

interface Balance {
  accountCode: string;
  currency: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}

async function soft<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) return null;
    throw error;
  }
}

/** `2026-07-30` from a date input, to epoch ms. `to` covers the whole day. */
function epoch(day: string, endOfDay: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(endOfDay ? `${day}T23:59:59.999Z` : `${day}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);

  if (!held.has(PERM.journalsRead)) {
    return { denied: true as const, permission: PERM.journalsRead };
  }

  const url = new URL(request.url);
  const account = (url.searchParams.get("account") ?? "").trim();
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const currency =
    (url.searchParams.get("currency") ?? "").trim() ||
    (typeof me.policy.currency === "string" ? me.policy.currency : "");

  const empty = {
    denied: false as const,
    account,
    currency,
    from,
    to,
    statement: null,
    balance: null
  };
  if (!account) return empty;

  const query = new URLSearchParams();
  if (currency) query.set("currency", currency);
  const fromMs = epoch(from, false);
  const toMs = epoch(to, true);
  if (fromMs !== null) query.set("from", String(fromMs));
  if (toMs !== null) query.set("to", String(toMs));

  const path = `/v1/ledger/accounts/${encodeURIComponent(account)}`;
  const [statement, balance] = await Promise.all([
    soft(api<Statement>(`${path}/statement?${query}`, { env, request })),
    soft(
      api<Balance>(`${path}/balance${currency ? `?currency=${encodeURIComponent(currency)}` : ""}`, {
        env,
        request
      })
    )
  ]);

  return { ...empty, statement, balance };
}

export default function LedgerAccount() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const navigation = useNavigation();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelIn(locale, shell?.domainPack);
  const busy = navigation.state !== "idle";

  if (loaded.denied) {
    return (
      <EmptyState title={l("denied")} body={l("deniedBody", { permission: loaded.permission })} />
    );
  }

  const { statement, balance, currency } = loaded;
  // Both numbers answer the same question from different sides: the statement
  // sums the journal, the balance reads the cache. They must agree.
  const drift =
    statement !== null && balance !== null && statement.closingMinor !== balance.balanceMinor;

  const columns: Array<Column<StatementLine>> = [
    {
      key: "postedAt",
      header: l("when"),
      render: (row) => <DateTime value={row.postedAt} locale={locale} precision="minute" />
    },
    {
      key: "side",
      header: l("txn.side"),
      render: (row) => (
        <Badge size="sm" tone={row.side === "debit" ? "info" : "neutral"}>
          {l(`side.${row.side}`)}
        </Badge>
      )
    },
    {
      key: "amount",
      header: l("amount"),
      numeric: true,
      render: (row) => <Money amountMinor={row.amountMinor} currency={row.currency} locale={locale} />
    },
    {
      key: "running",
      header: l("account.running"),
      numeric: true,
      render: (row) => (
        <Money amountMinor={row.runningMinor} currency={row.currency} locale={locale} signed />
      )
    },
    {
      key: "txn",
      header: l("account.txn"),
      render: (row) =>
        row.txnId ? (
          <Link
            to={`/ledger/transactions/${encodeURIComponent(row.txnId)}`}
            className="rounded-sm font-mono text-12 text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {row.txnId}
          </Link>
        ) : (
          l("none")
        )
    },
    { key: "memo", header: l("txn.memo"), render: (row) => row.memo ?? l("none") }
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{l("account.title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("account.intro")}</p>
      </header>

      <Form method="get" aria-label={l("account.lookup")} className="flex flex-wrap items-end gap-3">
        <Field label={l("account.code")} hint={l("account.hint")} className="w-52">
          <Input name="account" defaultValue={loaded.account} required />
        </Field>
        <Field label={l("currency")} className="w-28">
          <Input name="currency" defaultValue={currency} maxLength={3} />
        </Field>
        <Field label={l("account.from")} className="w-44">
          <Input name="from" type="date" defaultValue={loaded.from} />
        </Field>
        <Field label={l("account.to")} className="w-44">
          <Input name="to" type="date" defaultValue={loaded.to} />
        </Field>
        <Button type="submit" variant="secondary" loading={busy}>
          {t("common.apply")}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/ledger/accounts">{l("account.pick")}</Link>
        </Button>
      </Form>

      {statement === null ? (
        <EmptyState title={l("account.pick")} body={l("account.pickBody")} />
      ) : (
        <>
          <Card title={statement.accountCode} elevation="flat">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-5">
              <div className="flex flex-col gap-1">
                <dt className="font-ui text-12 text-subtle">{l("account.opening")}</dt>
                <dd className="font-mono text-20 tabular-nums text-text">
                  <Money
                    amountMinor={statement.openingMinor}
                    currency={balance?.currency ?? currency}
                    locale={locale}
                    signed
                  />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-ui text-12 text-subtle">{l("account.closing")}</dt>
                <dd className="font-mono text-20 tabular-nums text-text">
                  <Money
                    amountMinor={statement.closingMinor}
                    currency={balance?.currency ?? currency}
                    locale={locale}
                    signed
                  />
                </dd>
              </div>
              {balance ? (
                <>
                  <div className="flex flex-col gap-1">
                    <dt className="font-ui text-12 text-subtle">{l("txn.totalDebit")}</dt>
                    <dd className="font-ui text-13 text-text">
                      <Money
                        amountMinor={balance.debitMinor}
                        currency={balance.currency}
                        locale={locale}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-ui text-12 text-subtle">{l("txn.totalCredit")}</dt>
                    <dd className="font-ui text-13 text-text">
                      <Money
                        amountMinor={balance.creditMinor}
                        currency={balance.currency}
                        locale={locale}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-ui text-12 text-subtle">{l("account.balance")}</dt>
                    <dd className="font-ui text-13 text-text">
                      <Money
                        amountMinor={balance.balanceMinor}
                        currency={balance.currency}
                        locale={locale}
                        signed
                      />
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </Card>

          {drift ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-5"
            >
              <p className="font-serif text-18 leading-[1.3] text-text">{l("account.drift")}</p>
              <p className="max-w-prose font-ui text-13 text-muted">{l("account.driftBody")}</p>
              <div>
                <Button asChild variant="secondary">
                  <Link to="/ledger/period-close">{l("period.rebuild")}</Link>
                </Button>
              </div>
            </div>
          ) : null}

          <Table<StatementLine>
            caption={l("account.linesCaption")}
            captionHidden
            density="compact"
            columns={columns}
            rows={statement.lines}
            rowKey={(row) => `${row.batchId}|${row.seq}`}
            rowState={() => "sealed"}
            empty={<EmptyState title={l("account.empty")} body={l("account.emptyBody")} />}
          />
        </>
      )}
    </div>
  );
}
