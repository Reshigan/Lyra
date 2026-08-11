import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs
} from "react-router";
import { Badge, Button, Card, EmptyState, GuardrailNotice, Table, type Column } from "@lyra/ui";
import { ApiError, apiFetch, api, names } from "../api.server";
import { cloudflare } from "../context";
import { who } from "../names";
import { Gate } from "./staff";
import { useShellData } from "./workspace";
import {
  K_FLOOR,
  PERM,
  deltaPct,
  emptyPage,
  explain,
  indexText,
  inPeriod,
  labelsIn,
  latestPeriod,
  positionOf,
  rollByProvider,
  refuse,
  safe,
  type Label,
  type Page,
  type PanelRow,
  type Problemish,
  type ProviderRoll
} from "./scout.shared";

// Where each counterparty sits on price and conversion, for the newest period on
// the bench. Every figure is a volume weighting of scout_panel_bench — share of
// the period's volume, weighted win rate, weighted index against the panel
// median — so a provider with one thin line does not read like a market.
//
// The negotiation pack is proxied through this action rather than linked at the
// API origin: it is an audited PDF export of counterparty numbers, and proxying
// keeps the session cookie server-only the way the rest of this app does.
//
// Commission is deliberately absent. The mockup asks for it beside price and win
// rate, but scout_panel_bench has no commission column and distribution's
// commission ledger is another module's data — inventing the number here would
// be worse than the gap.

const LIMIT = 200;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const bench = await safe(
    () => api<Page<PanelRow>>(`/v1/scout/panel-bench?sort=period&order=desc&limit=${LIMIT}`, { env, request }),
    emptyPage<PanelRow>()
  );

  const period = latestPeriod(bench.data);
  const rows = inPeriod(bench.data, period);
  const rolls = rollByProvider(rows);
  // A bench row carries a provider id and no carrier name, so the column
  // headed CARRIER was six ULIDs (ADR-0048).
  const resolved = await names(
    rolls.map((roll) => roll.providerId),
    { env, request }
  );
  return { period, rolls, resolved, thin: bench.data.length === 0 };
}

export interface ActionResult {
  problem: Problemish | null;
  done: null;
}

/** The pack is a stream, so success is the file and failure is a problem. */
export async function action({ request, context }: ActionFunctionArgs): Promise<Response | ActionResult> {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "pack") return refuse("bad_intent");

  try {
    const upstream = await apiFetch("/v1/scout/panel-bench/negotiation-pack", { env, request });
    // Relay the API's own disposition and no-store: it decided the filename and
    // that this document must not be cached.
    const headers = new Headers();
    for (const name of ["content-type", "content-disposition", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof ApiError) return { problem: error.problem, done: null };
    throw error;
  }
}

export default function ScoutPanel() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shell = useShellData();
  const navigation = useNavigation();
  const locale = shell?.locale ?? "en";
  const l = labelsIn(locale, shell?.domainPack);
  const may = new Set(shell?.permissions ?? []);
  const busy = navigation.state !== "idle";
  const problem = result && "problem" in result ? result.problem : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-22 leading-[1.2] text-text">{l("panel.title")}</h1>
        <p className="max-w-prose font-ui text-13 text-muted">
          {l("panel.lede", { period: loaded.period ?? l("none") })}
        </p>
      </header>

      {problem ? <Gate problem={explain(problem, l)} l={l} /> : null}

      <Card>
        {loaded.rolls.length === 0 ? (
          <EmptyState title={l("panel.empty")} />
        ) : (
          <Table
            caption={l("panel.title")}
            captionHidden
            rowKey={(roll) => roll.providerId}
            rows={loaded.rolls}
            columns={panelColumns(l, locale, loaded.resolved)}
          />
        )}
      </Card>

      <GuardrailNotice
        tone="info"
        title={l("kFloor")}
        reason={l("kFloorWhy", { k: String(K_FLOOR) })}
      />

      {may.has(PERM.whitespacesPromote) ? (
        <Card title={l("panel.pack")} description={l("panel.packHint")}>
          <Form method="post" reloadDocument className="mt-2">
            <input type="hidden" name="intent" value="pack" />
            <Button type="submit" disabled={busy}>
              {l("panel.pack")}
            </Button>
          </Form>
        </Card>
      ) : (
        <GuardrailNotice tone="info" title={l("panel.pack")} reason={l("panel.packDenied")} />
      )}

      <footer className="flex flex-wrap gap-4">
        <Link to="/scout/pricing" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("panel.openPricing")}
        </Link>
        <Link to="/scout/analytics" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("an.title")}
        </Link>
      </footer>
    </div>
  );
}

export function panelColumns(
  l: Label,
  locale: string,
  resolved: Record<string, string> = {}
): Array<Column<ProviderRoll>> {
  const percent = (value: number | null) => (value === null ? l("none") : `${value.toLocaleString(locale)}%`);
  return [
    { key: "providerId", header: l("insurer"), render: (roll) => who(roll.providerId, resolved) },
    {
      key: "share",
      header: l("share"),
      numeric: true,
      render: (roll) => `${Math.round(roll.share * 100).toLocaleString(locale)}%`
    },
    { key: "volume", header: l("volume"), numeric: true, render: (roll) => roll.volume.toLocaleString(locale) },
    { key: "winRate", header: l("winRate"), numeric: true, render: (roll) => percent(roll.winRate) },
    {
      key: "index",
      header: l("priceIndex"),
      numeric: true,
      render: (roll) => {
        const pct = deltaPct(roll.ourIdx, roll.marketIdx);
        const tone = positionOf(pct);
        const text = indexText(roll.ourIdx, locale);
        if (text === null) return l("none");
        return (
          <span className={tone.tone === "success" ? "text-success" : tone.tone === "danger" ? "text-danger" : undefined}>
            {text}
          </span>
        );
      }
    },
    {
      key: "position",
      header: l("position"),
      render: (roll) => {
        const tone = positionOf(deltaPct(roll.ourIdx, roll.marketIdx));
        return (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={tone.tone === "neutral" ? "neutral" : tone.tone} size="sm">
              {l(tone.key)}
            </Badge>
            <span className="font-mono text-12 text-subtle">{roll.lines.join(" · ")}</span>
          </span>
        );
      }
    },
    {
      key: "gaps",
      header: l("panel.gaps"),
      numeric: true,
      render: (roll) => roll.gaps.toLocaleString(locale)
    }
  ];
}
