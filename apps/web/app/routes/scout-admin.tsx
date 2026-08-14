import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Badge, Card, DateTime, EmptyState, GuardrailNotice } from "@lyra/ui";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { useShellData } from "./workspace";
import {
  K_FLOOR,
  emptyPage,
  labelsIn,
  safe,
  type Label,
  type Page
} from "./scout.shared";

// SCOUT's own settings (docs/modules/scout.md §4 screen 6). The screen shows
// what actually governs the module and where each number lives, which for
// several of them is source rather than a tenant setting.
//
// What is configurable, and shown as such: the per-product suppression floor
// (scout_data_products.aggregation_min) and any versioned `scout.*` row in the
// compliance threshold store. What is compiled and named as compiled: the
// module's default k-anonymity floor. What has no store at all: the connector
// registry, crawl politeness, robots compliance and the template-hypothesis
// library — the screen says so rather than rendering an editor over nothing.
//
// Source health is derived, not configured: every source the module ingests is
// counted straight out of scout_signals with its latest observation, so a
// connector that has gone quiet is visible without a connector table existing.

/** docs/modules/scout.md §2 — the sources the harvester ingests. */
export const SIGNAL_SOURCES = ["search", "quotes", "abandonment", "reviews", "news", "regulatory"] as const;

/** A source silent this long is quiet, whatever its lifetime volume says. */
export const QUIET_AFTER_DAYS = 14;

const DAY = 86_400_000;

export interface SignalRow {
  id: string;
  source: string;
  observedAt: number;
}

export interface ProductRow {
  id: string;
  name: string;
  aggregationMin: number;
  status: string;
}

export interface ThresholdRow {
  id: string;
  key: string;
  version: number;
  valueJson: string;
  dualControl: boolean;
  effectiveFrom: number;
  effectiveTo: number | null;
  setBy: string;
}

export interface ApprovalRow {
  id: string;
  subjectRef: string;
  policyKey: string;
  decision: string;
  requestedAt: number;
}

export interface SourceHealth {
  source: string;
  count: number;
  lastAt: number | null;
  quiet: boolean;
}

export function healthOf(source: string, page: Page<SignalRow>, now: number): SourceHealth {
  const lastAt = page.data[0]?.observedAt ?? null;
  return {
    source,
    count: page.total ?? page.data.length,
    lastAt,
    // Never ingested and long since silent are different facts, and both are
    // quiet: a source with no row at all has nothing to be fresh.
    quiet: lastAt === null || now - lastAt > QUIET_AFTER_DAYS * DAY
  };
}

/**
 * The live version of each `scout.*` threshold. A change is a new version with
 * the old one closed off (seed/compliance.ts), so "current" means the highest
 * version that has not been superseded — never the newest row by id.
 */
export function currentThresholds(rows: ThresholdRow[]): ThresholdRow[] {
  const live = rows.filter((row) => row.key.startsWith("scout.") && row.effectiveTo === null);
  const byKey = new Map<string, ThresholdRow>();
  for (const row of live) {
    const held = byKey.get(row.key);
    if (!held || row.version > held.version) byKey.set(row.key, row);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Products whose own floor differs from the module default — the rest inherit. */
export const floorOverrides = (rows: ProductRow[]): ProductRow[] =>
  rows.filter((row) => row.aggregationMin !== K_FLOOR).sort((a, b) => a.aggregationMin - b.aggregationMin);

/** The one sentence admin opens with — pending approvals and quiet sources
 *  already on the loader, no ✦ (arithmetic, not an agent's finding, CLAUDE.md
 *  §11). */
export function adminHeadline(pending: number, sources: SourceHealth[], l: Label): string {
  if (pending > 0) return l("adm.headlinePending", { n: String(pending) });
  const quiet = sources.filter((source) => source.quiet).length;
  if (quiet > 0) return l("adm.headlineQuiet", { n: String(quiet) });
  return l("adm.title");
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const now = Date.now();

  const [sources, products, thresholds, approvals] = await Promise.all([
    Promise.all(
      SIGNAL_SOURCES.map(async (source) => {
        const page = await safe(
          () =>
            api<Page<SignalRow>>(
              `/v1/scout/signals?source=${source}&sort=observedAt&order=desc&limit=1&count=true`,
              { env, request }
            ),
          emptyPage<SignalRow>()
        );
        return healthOf(source, page, now);
      })
    ),
    safe(
      () => api<Page<ProductRow>>("/v1/scout/data-products?limit=100", { env, request }),
      emptyPage<ProductRow>()
    ),
    safe(
      () => api<Page<ThresholdRow>>("/v1/compliance/policy-thresholds?limit=200", { env, request }),
      emptyPage<ThresholdRow>()
    ),
    safe(
      () =>
        api<Page<ApprovalRow>>("/v1/core/approvals?module=scout&sort=requestedAt&order=desc&limit=20&count=true", {
          env,
          request
        }),
      emptyPage<ApprovalRow>()
    )
  ]);

  return {
    sources,
    overrides: floorOverrides(products.data),
    thresholds: currentThresholds(thresholds.data),
    approvals: approvals.data,
    pending: approvals.data.filter((row) => row.decision === "pending").length
  };
}

export default function ScoutAdmin() {
  const loaded = useLoaderData<typeof loader>();
  const shell = useShellData();
  const locale = shell?.locale ?? "en";
  const l = labelsIn(locale, shell?.domainPack);
  const ingested = loaded.sources.reduce((sum, one) => sum + one.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-22 leading-[1.2] text-text">
            {adminHeadline(loaded.pending, loaded.sources, l)}
          </h1>
          <p className="font-ui text-13 text-muted">{l("adm.lede")}</p>
        </div>
      </header>

      <Card title={l("adm.sources")} description={l("adm.sourcesHint", { days: String(QUIET_AFTER_DAYS) })}>
        <ul className="mt-3 flex flex-col gap-3">
          {loaded.sources.map((one) => (
            <li key={one.source} className="flex flex-wrap items-baseline gap-3 border-b border-line pb-3 last:border-0">
              <span className="min-w-40 font-ui text-13 text-text">{l(`source.${one.source}`)}</span>
              <span className="font-ui text-13 tabular-nums text-muted">{one.count.toLocaleString(locale)}</span>
              <span className="font-ui text-12 text-subtle">
                {ingested === 0 ? l("none") : `${Math.round((one.count / ingested) * 100)}%`}
              </span>
              <span className="font-ui text-12 text-subtle">
                {one.lastAt === null ? l("adm.neverIngested") : <DateTime value={one.lastAt} locale={locale} />}
              </span>
              <Badge tone={one.quiet ? "warning" : "success"} size="sm">
                {one.quiet ? l("adm.quiet") : l("adm.live")}
              </Badge>
            </li>
          ))}
        </ul>
        <GuardrailNotice tone="info" title={l("adm.noConnectors")} reason={l("adm.noConnectorsWhy")} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={l("adm.floors")} description={l("adm.floorsHint")}>
          <dl className="mt-3 flex flex-col gap-1">
            <dt className="font-ui text-12 text-subtle">{l("adm.defaultFloor")}</dt>
            <dd className="font-serif text-20 text-text">{K_FLOOR}</dd>
          </dl>
          <p className="mt-2 max-w-prose font-ui text-12 text-subtle">{l("adm.defaultFloorWhy")}</p>
          <h3 className="mt-4 font-ui text-13 font-medium text-text">{l("adm.overrides")}</h3>
          {loaded.overrides.length === 0 ? (
            <p className="mt-2 font-ui text-12 text-subtle">{l("adm.noOverrides")}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {loaded.overrides.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-ui text-13 text-text">{row.name}</span>
                  <Badge tone={row.aggregationMin < K_FLOOR ? "warning" : "neutral"} size="sm">
                    {l("dtp.k", { floor: String(row.aggregationMin) })}
                  </Badge>
                  <span className="font-ui text-12 text-subtle">{l(`dtp.status.${row.status}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={l("adm.thresholds")} description={l("adm.thresholdsHint")}>
          {loaded.thresholds.length === 0 ? (
            <EmptyState title={l("adm.noThresholds")} body={l("adm.noThresholdsWhy")} />
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {loaded.thresholds.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-ui text-13 text-text">{row.key}</span>
                    <Badge size="sm">{l("adm.version", { version: String(row.version) })}</Badge>
                    {row.dualControl ? (
                      <Badge tone="info" size="sm">
                        {l("adm.dualControl")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="font-ui text-12 text-subtle">{row.valueJson}</span>
                  <span className="font-ui text-12 text-subtle">
                    {l("adm.setBy", { who: row.setBy })} <DateTime value={row.effectiveFrom} locale={locale} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={l("adm.approvals")} description={l("adm.approvalsHint")}>
        <p className="mt-2 font-ui text-13 text-muted">{l("adm.pending", { count: String(loaded.pending) })}</p>
        {loaded.approvals.length === 0 ? (
          <EmptyState title={l("adm.noApprovals")} />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {loaded.approvals.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                <Badge tone={row.decision === "pending" ? "warning" : "neutral"} size="sm">
                  {row.decision}
                </Badge>
                <span className="font-ui text-13 text-text">{row.policyKey}</span>
                <span className="font-ui text-12 text-subtle">{row.subjectRef}</span>
                <DateTime value={row.requestedAt} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <GuardrailNotice tone="info" title={l("adm.noLibrary")} reason={l("adm.noLibraryWhy")} />

      <footer className="flex flex-wrap gap-4">
        <Link to="/scout/data-products" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("adm.openProducts")}
        </Link>
        <Link to="/approvals" className="font-ui text-13 text-accent underline-offset-2 hover:underline">
          {l("approvalLink")}
        </Link>
      </footer>
    </div>
  );
}
