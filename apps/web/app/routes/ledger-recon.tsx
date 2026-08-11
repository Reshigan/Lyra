import { useState } from "react";
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
  Checkbox,
  DateTime,
  EmptyState,
  Field,
  Input,
  Money,
  MoneyField,
  Ref,
  Select,
  shortRef,
  Table,
  Textarea,
  type Column
} from "@lyra/ui";
import { ApiError, api, fetchMe } from "../api.server";
import { cloudflare } from "../context";
import { translator } from "../i18n";
import { ConfirmButton } from "../components/confirm";
import { Problem } from "./module";
import { useShellData } from "./workspace";
import { PERM, labelIn, statementFromCsv, type StatementLine } from "./ledger.shared";

// A reconciliation run is arithmetic; deciding a match is a judgement. The
// judgement carries a name and a reason onto the record, so the decide control
// asks for the reason in the same breath as the decision.

const PROCESSES = ["insurer", "psp", "client_money", "partner", "media"] as const;

interface ReconRun {
  id: string;
  process: string;
  period: string;
  currency: string;
  state: string;
  matchedCount: number;
  varianceCount: number;
  varianceMinor: number;
  counterpartyRef: string | null;
  createdAt: number;
}

interface ReconSummary {
  runId: string;
  process: string;
  period: string;
  state: string;
  matchedCount: number;
  varianceCount: number;
  varianceMinor: number;
  currency: string;
  open: number;
}

interface ReconMatch {
  id: string;
  runId: string;
  statementLineRef: string | null;
  txnId: string | null;
  amountMinor: number;
  currency: string;
  deltaMinor: number;
  method: string;
  confidence: number | null;
  state: string;
  reasonCode: string | null;
  confirmedBy: string | null;
  confirmedAt: number | null;
}

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
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);

  if (!held.has(PERM.reconRead) && !held.has(PERM.reconRun)) {
    return { denied: true as const, permission: PERM.reconRead };
  }

  const runId = new URL(request.url).searchParams.get("run") ?? "";
  const currency = typeof me.policy.currency === "string" ? me.policy.currency : "";

  const [summary, matches, runs] = await Promise.all([
    runId && held.has(PERM.reconRead)
      ? soft(api<ReconSummary>(`/v1/ledger/recon/runs/${encodeURIComponent(runId)}`, { env, request }))
      : Promise.resolve(null),
    runId && held.has(PERM.reconRead)
      ? soft(
          api<{ data: ReconMatch[] }>(
            `/v1/ledger/recon-matches?runId=${encodeURIComponent(runId)}&sort=createdAt&order=asc&limit=200`,
            { env, request }
          )
        )
      : Promise.resolve(null),
    held.has(PERM.reconRead)
      ? soft(
          api<{ data: ReconRun[] }>("/v1/ledger/recon-runs?sort=createdAt&order=desc&limit=10", {
            env,
            request
          })
        )
      : Promise.resolve(null)
  ]);

  return {
    denied: false as const,
    runId,
    currency,
    summary,
    matches: matches?.data ?? [],
    runs: runs?.data ?? [],
    canRun: held.has(PERM.reconRun),
    canDecide: held.has(PERM.reconConfirm)
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const empty = { problem: null, started: null, decided: null, rejected: [] as Array<{ row: number; text: string }> };

  try {
    if (intent === "decide") {
      const reasonCode = String(form.get("reasonCode") ?? "").trim();
      const decision = String(form.get("decision") ?? "");
      if (!reasonCode) return { ...empty, problem: { title: "reason", status: 400 } };
      await api(`/v1/ledger/recon/matches/${encodeURIComponent(String(form.get("matchId") ?? ""))}/decide`, {
        env,
        request,
        method: "POST",
        // Who is the session; why is this, and the API writes both onto the match.
        body: { decision, reasonCode: reasonCode.slice(0, 64) }
      });
      return { ...empty, decided: decision };
    }

    const currency = String(form.get("currency") ?? "");
    // The statement is read here, not in the browser: the run posts what the
    // server parsed, so a preview that drifted cannot change what reconciles.
    const { lines, rejected } = statementFromCsv(String(form.get("lines") ?? ""), currency);
    if (!lines.length) return { ...empty, problem: { title: "lines", status: 400 } };
    if (rejected.length) return { ...empty, rejected };

    const counterparty = String(form.get("counterpartyRef") ?? "").trim();
    const tolerance = String(form.get("toleranceMinor") ?? "").trim();
    const result = await api<{
      runId: string;
      matched: number;
      variances: number;
    }>("/v1/ledger/recon/runs", {
      env,
      request,
      method: "POST",
      body: {
        process: String(form.get("process") ?? ""),
        period: String(form.get("period") ?? ""),
        currency,
        ...(counterparty ? { counterpartyRef: counterparty } : {}),
        ...(tolerance ? { toleranceMinor: Number(tolerance) } : {}),
        propose: form.get("propose") === "on",
        lines
      }
    });
    return { ...empty, started: result };
  } catch (error) {
    if (error instanceof ApiError) return { ...empty, problem: error.problem };
    throw error;
  }
}

export default function LedgerRecon() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelIn(locale, shell?.domainPack);
  // The money field's precision follows the currency beside it: 500 in JPY is
  // 500 minor units, in ZAR it is 50000.
  const [currency, setCurrency] = useState(loaded.currency);
  // The pasted statement lives in state so the screen can show what it read
  // back — the operator checks the rows, not the paste.
  const [statement, setStatement] = useState("");

  const busy = navigation.state !== "idle";

  if (loaded.denied) {
    return (
      <EmptyState title={l("denied")} body={l("deniedBody", { permission: loaded.permission })} />
    );
  }

  const summary = loaded.summary;

  const matchColumns: Array<Column<ReconMatch>> = [
    {
      key: "statementLineRef",
      header: l("recon.statementRef"),
      render: (row) => <Ref value={row.statementLineRef} className="text-12" fallback={l("none")} />
    },
    {
      key: "txnId",
      header: l("recon.txn"),
      render: (row) =>
        row.txnId ? (
          <Link
            to={`/ledger/transactions/${encodeURIComponent(row.txnId)}`}
            className="rounded-sm font-mono text-12 text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {shortRef(row.txnId)}
          </Link>
        ) : (
          l("none")
        )
    },
    {
      key: "amountMinor",
      header: l("amount"),
      numeric: true,
      render: (row) => <Money amountMinor={row.amountMinor} currency={row.currency} locale={locale} />
    },
    {
      key: "deltaMinor",
      header: l("recon.delta"),
      numeric: true,
      render: (row) => (
        <Money
          amountMinor={row.deltaMinor}
          currency={row.currency}
          locale={locale}
          signed
          toned={row.deltaMinor !== 0}
        />
      )
    },
    {
      key: "method",
      header: l("recon.method"),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge size="sm" tone={row.method === "ai_proposed" ? "info" : "neutral"}>
            {l(`method.${row.method}`)}
          </Badge>
          {row.confidence === null ? null : (
            <span className="font-ui text-12 text-subtle">{row.confidence}%</span>
          )}
        </span>
      )
    },
    {
      key: "state",
      header: l("state"),
      render: (row) => (
        <Badge
          size="sm"
          tone={row.state === "confirmed" ? "success" : row.state === "rejected" ? "danger" : "warning"}
        >
          {l(`match.${row.state}`)}
        </Badge>
      )
    },
    {
      key: "decided",
      header: l("recon.decidedBy"),
      render: (row) =>
        row.confirmedBy ? (
          <span className="flex flex-col">
            <span className="font-ui text-13 text-text">{row.confirmedBy}</span>
            {row.reasonCode ? (
              <span className="font-ui text-12 text-subtle">{row.reasonCode}</span>
            ) : null}
          </span>
        ) : (
          l("none")
        )
    },
    {
      key: "decide",
      header: l("recon.decide"),
      // A decision is offered only where one is still owed, and only to the
      // permission the API enforces. Otherwise the column is empty, not disabled.
      render: (row) =>
        loaded.canDecide && row.state === "proposed" ? (
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="decide" />
            <input type="hidden" name="matchId" value={row.id} />
            <Field label={l("recon.reasonCode")} labelHidden className="w-48">
              <Input name="reasonCode" maxLength={64} required placeholder={l("recon.reasonCode")} />
            </Field>
            <ConfirmButton
              type="submit"
              name="decision"
              value="confirmed"
              size="sm"
              loading={busy}
              message={l("recon.confirmConfirm")}
            >
              {l("recon.confirm")}
            </ConfirmButton>
            <ConfirmButton
              type="submit"
              name="decision"
              value="rejected"
              size="sm"
              variant="ghost"
              loading={busy}
              message={l("recon.rejectConfirm")}
            >
              {l("recon.reject")}
            </ConfirmButton>
          </Form>
        ) : null
    }
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-22 leading-[1.2] text-text">{l("recon.title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("recon.intro")}</p>
      </header>

      <p role="status" aria-live="polite" className="font-ui text-13 text-success">
        {result?.started
          ? l("recon.started", {
              id: result.started.runId,
              matched: result.started.matched,
              variances: result.started.variances
            })
          : result?.decided
            ? l("recon.decided", { decision: l(`match.${result.decided}`) })
            : ""}
      </p>

      {result?.problem ? (
        <Problem
          problem={
            result.problem.title === "lines"
              ? { title: l("recon.linesInvalid") }
              : result.problem.title === "reason"
                ? { title: l("reasonRequired") }
                : result.problem
          }
        />
      ) : null}

      {result?.rejected?.length ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="font-ui text-13 text-text">{l("recon.linesRejected")}</p>
          <ul className="flex flex-col gap-1">
            {result.rejected.map((row) => (
              <li key={row.row} className="font-mono text-12 text-muted">
                {l("recon.linesRow", { row: String(row.row) })} — {row.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result?.started ? (
        <div>
          <Button asChild variant="secondary">
            <Link to={`/ledger/recon?run=${encodeURIComponent(result.started.runId)}`}>
              {l("recon.run")}
            </Link>
          </Button>
        </div>
      ) : null}

      <Form method="get" aria-label={l("recon.lookup")} className="flex flex-wrap items-end gap-3">
        <Field label={l("recon.runId")} className="w-80">
          <Input name="run" defaultValue={loaded.runId} />
        </Field>
        <Button type="submit" variant="secondary" loading={busy}>
          {t("common.apply")}
        </Button>
      </Form>

      {summary ? (
        <Card
          title={`${l(`process.${summary.process}`)} · ${summary.period}`}
          description={summary.runId}
          elevation="flat"
          actions={
            <Badge tone={summary.state === "closed" ? "success" : "warning"}>
              {l(`state.${summary.state}`)}
            </Badge>
          }
        >
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-5">
            <div className="flex flex-col gap-1">
              <dt className="font-ui text-12 text-subtle">{l("recon.matched")}</dt>
              <dd className="font-mono text-22 tabular-nums text-text">{summary.matchedCount}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-ui text-12 text-subtle">{l("recon.variance")}</dt>
              <dd className="font-mono text-22 tabular-nums text-text">{summary.varianceCount}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-ui text-12 text-subtle">{l("recon.varianceMinor")}</dt>
              <dd className="font-mono text-22 tabular-nums text-text">
                <Money
                  amountMinor={summary.varianceMinor}
                  currency={summary.currency}
                  locale={locale}
                  signed
                  toned={summary.varianceMinor !== 0}
                />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-ui text-12 text-subtle">{l("recon.open")}</dt>
              <dd className="font-mono text-22 tabular-nums text-text">{summary.open}</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      {loaded.runId ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">{l("recon.matches")}</h2>
          <Table<ReconMatch>
            caption={l("recon.matchesCaption")}
            captionHidden
            density="compact"
            columns={matchColumns}
            rows={loaded.matches}
            rowKey={(row) => row.id}
            empty={<EmptyState title={l("recon.noMatches")} body={l("recon.noMatchesBody")} />}
          />
        </section>
      ) : (
        <EmptyState title={l("recon.pick")} body={l("recon.pickBody")} />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">{l("recon.runs")}</h2>
        <Table<ReconRun>
          caption={l("recon.runsCaption")}
          captionHidden
          density="compact"
          rows={loaded.runs}
          rowKey={(row) => row.id}
          empty={<EmptyState title={l("recon.noRuns")} />}
          columns={[
              {
                key: "process",
                header: l("recon.process"),
                render: (row) => (
                  <Link
                    to={`/ledger/recon?run=${encodeURIComponent(row.id)}`}
                    className="rounded-sm font-ui text-13 text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  >
                    {l(`process.${row.process}`)}
                  </Link>
                )
              },
              { key: "period", header: l("recon.period"), render: (row) => row.period },
              {
                key: "state",
                header: l("state"),
                render: (row) => (
                  <Badge size="sm" tone={row.state === "closed" ? "success" : "warning"}>
                    {l(`state.${row.state}`)}
                  </Badge>
                )
              },
              {
                key: "matchedCount",
                header: l("recon.matched"),
                numeric: true,
                render: (row) => row.matchedCount
              },
              {
                key: "varianceMinor",
                header: l("recon.varianceMinor"),
                numeric: true,
                render: (row) => (
                  <Money
                    amountMinor={row.varianceMinor}
                    currency={row.currency}
                    locale={locale}
                    signed
                    toned={row.varianceMinor !== 0}
                  />
                )
              },
              {
                key: "createdAt",
                header: l("when"),
                render: (row) => <DateTime value={row.createdAt} locale={locale} precision="minute" />
              }
          ]}
        />
      </section>

      {loaded.canRun ? (
        <Card title={l("recon.start")} elevation="flat">
          <Form method="post" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={l("recon.process")} required className="w-52">
                <Select
                  name="process"
                  defaultValue="insurer"
                  options={PROCESSES.map((process) => ({
                    value: process,
                    label: l(`process.${process}`)
                  }))}
                />
              </Field>
              <Field label={l("recon.period")} required className="w-40">
                <Input name="period" defaultValue={new Date().toISOString().slice(0, 7)} required />
              </Field>
              <Field label={l("currency")} required className="w-28">
                <Input
                  name="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                  required
                />
              </Field>
              {/* ponytail: a free text id, not a picker — finance roles hold
                  `dist:channels:read` but no `core:providers:read`, so half the
                  counterparties cannot be listed to them. The hint says what to
                  paste; widening the grant is an ADR, not a form change. */}
              <Field
                label={l("recon.counterparty")}
                hint={l("recon.counterpartyHint")}
                className="w-56"
              >
                <Input name="counterpartyRef" />
              </Field>
              <Field label={l("recon.tolerance")} className="w-44">
                <MoneyField name="toleranceMinor" currency={currency || "ZAR"} locale={locale} min={0} />
              </Field>
            </div>

            <Field label={l("recon.lines")} hint={l("recon.linesHint")} required>
              {/* The statement as the counterparty exported it. No defaultValue:
                  an empty paste must fail `required` rather than post a run
                  against nothing. */}
              <Textarea
                name="lines"
                rows={8}
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                placeholder={l("recon.linesPlaceholder")}
                className="font-mono text-12"
                required
              />
            </Field>

            <StatementPreview
              text={statement}
              currency={currency || "ZAR"}
              locale={locale}
              l={l}
            />

            <Checkbox name="propose" label={l("recon.propose")} />
            <p className="font-ui text-12 text-subtle">{l("recon.proposeHint")}</p>

            <div>
              <ConfirmButton type="submit" loading={busy} message={l("recon.startConfirm")}>
                {l("recon.start")}
              </ConfirmButton>
            </div>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * What the server will read out of the paste, shown before the run starts. It
 * reconciles nothing and posts nothing — it is the statement said back in
 * words, so a mis-shaped column is caught by eye rather than by a wrong match.
 */
function StatementPreview({
  text,
  currency,
  locale,
  l
}: {
  text: string;
  currency: string;
  locale: string;
  l: (key: string, vars?: Record<string, string>) => string;
}) {
  const { lines, rejected } = statementFromCsv(text, currency);
  if (!text.trim()) return null;

  return (
    <div className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="font-ui text-12 text-subtle">
        {l("recon.linesRead", { count: String(lines.length), rejected: String(rejected.length) })}
      </p>
      {lines.length ? (
        <Table<StatementLine & { row: number }>
          caption={l("recon.linesCaption")}
          captionHidden
          density="compact"
          columns={[
            {
              key: "ref",
              header: l("recon.statementRef"),
              render: (row) => <Ref value={row.ref} className="text-12" />
            },
            {
              key: "amountMinor",
              header: l("recon.lineAmount"),
              numeric: true,
              render: (row) => (
                <Money amountMinor={row.amountMinor} currency={row.currency} locale={locale} />
              )
            },
            {
              key: "ourRef",
              header: l("recon.lineOurRef"),
              render: (row) => <Ref value={row.ourRef ?? null} className="text-12" fallback={l("none")} />
            },
            {
              key: "postedAt",
              header: l("recon.linePostedAt"),
              render: (row) =>
                row.postedAt === undefined ? (
                  l("none")
                ) : (
                  <DateTime value={row.postedAt} locale={locale} precision="day" />
                )
            },
            {
              key: "description",
              header: l("recon.lineDescription"),
              render: (row) => row.description ?? l("none")
            }
          ]}
          rows={lines.slice(0, 20).map((line, index) => ({ ...line, row: index }))}
          rowKey={(row) => `${row.ref}.${row.row}`}
        />
      ) : null}
      {lines.length > 20 ? (
        <p className="font-ui text-12 text-subtle">
          {l("recon.linesMore", { count: String(lines.length - 20) })}
        </p>
      ) : null}
    </div>
  );
}
