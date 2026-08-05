import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Badge, Card, EmptyState, KPIWall, Money, Stat, Table, type Column } from "@lyra/ui";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { useShellData } from "./workspace";
import {
  WINDOWS,
  audienceValue,
  labelsIn,
  ltvToCac,
  safe,
  windowDays,
  type AudienceRow,
  type AudienceValue,
  type CampaignRow,
  type Label,
  type Page,
  type SpendRow,
  type TouchRow
} from "./signal.shared";

// What each audience is worth against what it costs to reach. The `audiences`
// tab lists definitions and cached sizes; it cannot say which of them makes
// money, because value lives in the attribution ledger and cost lives in the
// spend ledger and neither carries an audience.
//
// The join is the campaign: an audience is worth what the campaigns aimed at it
// bound, and costs what those campaigns spent (audienceValue in signal.shared).
// Read-only — an audience definition is edited on its own tab.

/** Below this many signings the multiple is noise, not a number. */
const THIN = 5;

const empty = <T,>(): Page<T> => ({ data: [] });

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const days = windowDays(new URL(request.url).searchParams.get("days"));
  const from = Date.now() - days * 86_400_000;

  const [audiences, campaigns, spend, touches] = await Promise.all([
    safe(() => api<Page<AudienceRow>>("/v1/signal/audiences?limit=200", { env, request }), empty<AudienceRow>()),
    safe(() => api<Page<CampaignRow>>("/v1/signal/campaigns?limit=200", { env, request }), empty<CampaignRow>()),
    safe(
      () => api<Page<SpendRow>>(`/v1/signal/spend?sort=ts&from=${from}&limit=200`, { env, request }),
      empty<SpendRow>()
    ),
    safe(
      () =>
        api<Page<TouchRow>>(`/v1/signal/attribution-events?sort=ts&from=${from}&limit=200`, { env, request }),
      empty<TouchRow>()
    )
  ]);

  const rows = audienceValue(audiences.data, campaigns.data, spend.data, touches.data);
  const measured = rows.filter((row) => row.binds >= THIN && row.multiple !== null);
  return {
    days,
    rows,
    currency: spend.data[0]?.currency ?? touches.data.find((touch) => touch.currency)?.currency ?? "ZAR",
    totalValueMinor: rows.reduce((sum, row) => sum + row.valueMinor, 0),
    best: measured.reduce<AudienceValue | null>(
      (top, row) => (top === null || (row.multiple ?? 0) > (top.multiple ?? 0) ? row : top),
      null
    ),
    losing: measured.filter((row) => (row.multiple ?? 0) < 1).length
  };
}

export default function AudienceValueScreen() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const l = labelsIn(shell?.locale ?? "en", shell?.domainPack);
  const locale = shell?.locale ?? "en";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-24 font-bold text-text">{l("aud.title")}</h1>
          <p className="max-w-prose font-ui text-13 text-muted">{l("aud.lede")}</p>
        </div>
        <nav aria-label={l("growth.window")} className="flex items-center gap-2">
          {WINDOWS.map((days) => (
            <Link
              key={days}
              to={`/signal/audience-value?days=${days}`}
              aria-current={loaded.days === days ? "page" : undefined}
            >
              <Badge tone={loaded.days === days ? "accent" : "neutral"}>{l("days", { n: String(days) })}</Badge>
            </Link>
          ))}
        </nav>
      </header>

      <KPIWall>
        <Stat
          label={l("aud.totalValue")}
          value={<Money amountMinor={loaded.totalValueMinor} currency={loaded.currency} locale={locale} />}
          hint={l("days", { n: String(loaded.days) })}
        />
        <Stat
          label={l("aud.best")}
          value={loaded.best ? loaded.best.audience.name : l("none")}
          hint={loaded.best?.multiple ? `${loaded.best.multiple.toFixed(1)}×` : undefined}
        />
        <Stat label={l("aud.worst")} value={String(loaded.losing)} />
      </KPIWall>

      <Card title={l("aud.title")} description={l("aud.caption")}>
        {loaded.rows.length === 0 ? (
          <EmptyState
            title={l("aud.unmeasured")}
            className="mt-4"
            action={
              <Link to="/signal/audiences" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
                {l("aud.openAudiences")}
              </Link>
            }
          />
        ) : (
          <Table
            className="mt-4"
            caption={l("aud.caption")}
            captionHidden
            rowKey={(row) => row.audience.id}
            rows={loaded.rows}
            columns={valueColumns(l, locale, loaded.currency)}
          />
        )}
      </Card>

      <footer className="flex flex-wrap gap-4">
        <Link to="/signal/audiences" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("aud.openAudiences")}
        </Link>
        <Link to="/signal/analytics" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("growth.title")}
        </Link>
      </footer>
    </div>
  );
}

function valueColumns(l: Label, locale: string, currency: string): Array<Column<AudienceValue>> {
  const money = (amountMinor: number) => <Money amountMinor={amountMinor} currency={currency} locale={locale} />;
  return [
    { key: "name", header: l("audience"), render: (row) => row.audience.name },
    {
      key: "size",
      header: l("aud.size"),
      numeric: true,
      render: (row) => (row.audience.sizeCached === null ? l("none") : row.audience.sizeCached.toLocaleString(locale))
    },
    { key: "reach", header: l("aud.reach"), numeric: true, render: (row) => String(row.campaigns) },
    { key: "spend", header: l("spend"), numeric: true, render: (row) => money(row.spendMinor) },
    { key: "binds", header: l("binds"), numeric: true, render: (row) => String(row.binds) },
    { key: "value", header: l("value"), numeric: true, render: (row) => money(row.valueMinor) },
    {
      key: "cac",
      header: l("cac"),
      numeric: true,
      render: (row) => (row.cacMinor === null ? l("none") : money(row.cacMinor))
    },
    {
      key: "ltv",
      header: l("ltv"),
      numeric: true,
      render: (row) => (row.ltvMinor === null ? l("none") : money(row.ltvMinor))
    },
    {
      key: "multiple",
      header: l("multiple"),
      numeric: true,
      render: (row) => {
        if (row.campaigns === 0) return <span className="text-subtle">{l("aud.unmeasured")}</span>;
        // A multiple built on two signings would be read as a finding; say so
        // rather than printing it (docs/22: a number without its confidence lies).
        if (row.binds < THIN) return <span className="text-subtle">{l("aud.thin")}</span>;
        const ratio = ltvToCac(row.ltvMinor, row.cacMinor);
        return ratio === null ? (
          l("none")
        ) : (
          <span className={ratio < 1 ? "text-danger" : undefined}>{ratio.toFixed(1)}×</span>
        );
      }
    },
    {
      key: "conversion",
      header: l("aud.conversion"),
      numeric: true,
      render: (row) => (row.conversionPct > 0 ? `${row.conversionPct}%` : l("none"))
    }
  ];
}
