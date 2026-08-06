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
  Input,
  Select,
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
import { PERM, labelIn, mintKey } from "./ledger.shared";

// Opening a transaction is the only way money starts moving, so it is a form
// with a catalogue rather than a row in a table: the type decides the recipe,
// the recipe decides the journal, and the ledger validates both.
//
// The recipe's own argument schema is private to @lyra/ledger — `GET /txn-types`
// publishes the catalogue, not the shapes — so arguments are entered as JSON and
// the API's field-error map is rendered back beside the field. See the report:
// an additive `args` field list on that endpoint would turn this into inputs.

interface TxnType {
  code: string;
  financial: boolean;
  approval: string | null;
  payout?: true;
  clientMoney?: true;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const me = await fetchMe(env, request);
  const held = new Set(me.permissions);

  // Reading the catalogue is gated on ledger:txns:read; opening one on
  // ledger:txns:create. Without create there is nothing to do here.
  if (!held.has(PERM.txnsCreate)) {
    return { denied: true as const, permission: PERM.txnsCreate };
  }

  const types = await api<{ data: TxnType[] }>("/v1/ledger/txn-types", { env, request });
  const currency = typeof me.policy.currency === "string" ? me.policy.currency : "";

  return {
    denied: false as const,
    types: types.data,
    currency,
    /**
     * Two keys, both minted server side, once per render of this form.
     *
     * `headerKey` is the HTTP `idempotency-key` the API replays on
     * (packages/core withIdempotency); `naturalKey` is the transaction's own
     * key on the unique index (tenant, type, idempotencyKey), which the
     * operator may replace with something meaningful — `bind:{caseId}`.
     * Either one alone stops a double press posting twice.
     */
    headerKey: mintKey("web.open"),
    naturalKey: mintKey("web")
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const type = String(form.get("type") ?? "");
  const rawArgs = String(form.get("args") ?? "").trim();
  const gross = String(form.get("grossMinor") ?? "").trim();
  const currency = String(form.get("currency") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();

  let args: unknown = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { problem: { title: "args", status: 400 }, opened: null, approval: null };
    }
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return { problem: { title: "args", status: 400 }, opened: null, approval: null };
    }
  }

  try {
    const result = await api<{ txn: { id: string; state: string } }>(
      `/v1/ledger/txn/${encodeURIComponent(type)}`,
      {
        env,
        request,
        method: "POST",
        // The one endpoint in this module that replays on the HTTP header.
        headers: { "idempotency-key": String(form.get("headerKey") ?? "") },
        body: {
          idempotencyKey: String(form.get("naturalKey") ?? ""),
          ...(currency ? { currency } : {}),
          ...(gross ? { grossMinor: Number(gross) } : {}),
          ...(reason ? { reason } : {}),
          args
        }
      }
    );
    return { problem: null, opened: result.txn, approval: null };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.problem as { code?: string; policy_key?: string };
      if (p.code === "approval_required") {
        return { problem: null, opened: null, approval: p.policy_key ?? "" };
      }
      return { problem: error.problem, opened: null, approval: null };
    }
    throw error;
  }
}

export default function LedgerOpenTxn() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const locale = shell?.locale ?? "en";
  const t = translator(locale);
  const l = labelIn(locale);
  const busy = navigation.state !== "idle";

  if (loaded.denied) {
    return (
      <EmptyState title={l("denied")} body={l("deniedBody", { permission: loaded.permission })} />
    );
  }

  const columns: Array<Column<TxnType>> = [
    {
      key: "code",
      header: l("open.code"),
      render: (row) => <span className="font-mono text-12">{row.code}</span>
    },
    {
      key: "kind",
      header: t("common.details"),
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Badge size="sm" tone={row.financial ? "accent" : "neutral"}>
            {row.financial ? l("open.financial") : l("open.nonFinancial")}
          </Badge>
          {row.approval ? (
            <Badge size="sm" tone="warning">
              {l("open.approval")}
            </Badge>
          ) : null}
          {row.payout ? (
            <Badge size="sm" tone="warning">
              {l("open.payout")}
            </Badge>
          ) : null}
          {row.clientMoney ? (
            <Badge size="sm" tone="info">
              {l("open.clientMoney")}
            </Badge>
          ) : null}
        </span>
      )
    },
    {
      key: "policy",
      header: l("txn.approvals"),
      render: (row) =>
        row.approval ? <span className="font-mono text-12">{row.approval}</span> : l("none")
    }
  ];

  // The API names the argument fields it wanted when the recipe refuses.
  const fieldErrors = Object.entries(result?.problem?.errors ?? {});

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-24 leading-[1.2] text-text">{l("open.title")}</h1>
        <p className="max-w-prose font-ui text-13 text-subtle">{l("open.intro")}</p>
      </header>

      {result?.approval !== null && result?.approval !== undefined ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-5"
        >
          <p className="font-serif text-18 leading-[1.3] text-text">{l("txn.approvalRaised")}</p>
          <p className="max-w-prose font-ui text-13 text-muted">{l("txn.approvalRaisedBody")}</p>
          <div>
            <Button asChild variant="secondary">
              <Link to="/approvals">{l("txn.approvalsInbox")}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <p role="status" aria-live="polite" className="font-ui text-13 text-success">
          {result?.opened ? l("open.openedAs", { id: result.opened.id }) : ""}
        </p>
      )}

      {result?.opened ? (
        <div>
          <Button asChild variant="secondary">
            <Link to={`/ledger/transactions/${encodeURIComponent(result.opened.id)}`}>
              {l("open.openRecord")}
            </Link>
          </Button>
        </div>
      ) : null}

      {result?.problem ? (
        result.problem.title === "args" ? (
          <Problem problem={{ title: l("open.argsInvalid") }} />
        ) : (
          <Problem problem={result.problem} />
        )
      ) : null}

      {fieldErrors.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger/10 p-3">
          {fieldErrors.map(([path, message]) => (
            <li key={path} className="font-ui text-13 text-text">
              <span className="font-mono text-12 text-muted">{path}</span> — {message}
            </li>
          ))}
        </ul>
      ) : null}

      <Card title={l("open.title")} elevation="flat">
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="headerKey" value={loaded.headerKey} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label={l("open.type")} required className="w-64">
              <Select
                name="type"
                defaultValue={loaded.types[0]?.code ?? ""}
                options={loaded.types.map((type) => ({ value: type.code, label: type.code }))}
              />
            </Field>
            <Field label={l("currency")} className="w-28">
              <Input name="currency" defaultValue={loaded.currency} maxLength={3} />
            </Field>
            <Field label={l("open.gross")} className="w-44">
              <Input name="grossMinor" type="number" step="1" inputMode="numeric" />
            </Field>
          </div>

          <Field label={l("open.key")} hint={l("open.keyHint")} required>
            <Input name="naturalKey" defaultValue={loaded.naturalKey} maxLength={200} required />
          </Field>

          <Field label={l("open.args")} hint={l("open.argsHint")}>
            <Textarea name="args" rows={6} defaultValue="{}" className="font-mono text-12" />
          </Field>

          <Field label={l("reason")}>
            <Input name="reason" maxLength={500} />
          </Field>

          <p className="font-ui text-12 text-subtle">{l("idempotencyNote")}</p>
          <div>
            <ConfirmButton type="submit" loading={busy} message={l("open.confirm")}>
              {l("open.submit")}
            </ConfirmButton>
          </div>
        </Form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-ui text-12 font-medium uppercase tracking-[0.14em] text-subtle">{l("open.catalogue")}</h2>
        <Table<TxnType>
          caption={l("open.catalogueCaption")}
          captionHidden
          density="compact"
          columns={columns}
          rows={loaded.types}
          rowKey={(row) => row.code}
        />
      </section>
    </div>
  );
}
