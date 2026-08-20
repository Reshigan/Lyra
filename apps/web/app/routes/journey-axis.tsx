import { Hero, ScreenState, renderSection, hueVar, type Section } from "@lyra/ui";
import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { JourneyNav, JourneyContinue } from "../components/journey-nav";
import { translator, DEFAULT_LOCALE } from "../i18n";
import { useShellData } from "./workspace";

interface CaseRow {
  id: string;
  ref: string;
  productLine: string;
  status: string;
  priority: string;
  valueMinor: number;
  currency: string;
}

interface ProductLineTotal {
  productLine: string;
  total: number;
  count: number;
  currency: string;
}

const CASES_LIMIT = 200;
const HERO_GROUPS = 6;

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function groupByProductLine(cases: CaseRow[]): ProductLineTotal[] {
  const byLine = new Map<string, ProductLineTotal>();
  for (const c of cases) {
    const line = c.productLine || "unassigned";
    const existing = byLine.get(line);
    if (existing) {
      existing.total += c.valueMinor;
      existing.count += 1;
    } else {
      byLine.set(line, { productLine: line, total: c.valueMinor, count: 1, currency: c.currency });
    }
  }
  return [...byLine.values()].sort((a, b) => b.total - a.total);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const page = await api<{ data: CaseRow[] }>(
    `/v1/axis/cases?limit=${CASES_LIMIT}&sort=valueMinor&order=desc`,
    { env, request }
  );
  const lines = groupByProductLine(page.data);
  return { lines, caseCount: page.data.length };
}

export default function JourneyAxis({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { lines, caseCount } = loaderData;
  const shell = useShellData();
  const t = translator(shell?.locale ?? DEFAULT_LOCALE, shell?.overrides);
  const top = lines[0] ?? null;
  const maxTotal = top?.total ?? 1;
  const totalValue = lines.reduce((s, l) => s + l.total, 0);

  const bars: Section = {
    kind: "bars",
    title: "Book value by product line",
    items: lines.map((line) => ({
      label: line.productLine,
      value: money(line.total, line.currency),
      w: `${Math.max(4, Math.round((line.total / maxTotal) * 100))}%`,
      hue: hueVar("axis"),
      note: `${line.count} case${line.count === 1 ? "" : "s"}`
    }))
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <JourneyNav current="axis" t={t} />
      <Hero
        eyebrow="AXIS"
        title={t("journey.axis.title")}
        sub={`${caseCount} case${caseCount === 1 ? "" : "s"} across ${lines.length} product line${lines.length === 1 ? "" : "s"}.`}
        mod="axis"
        hero={{
          chips: [
            { label: "Total book value", value: top ? money(totalValue, top.currency) : "0", hue: hueVar("axis") },
            ...lines.slice(0, HERO_GROUPS).map((line) => ({
              label: line.productLine,
              value: money(line.total, line.currency),
              hue: hueVar("axis"),
              detail: `${line.count} case${line.count === 1 ? "" : "s"} — ${Math.round((line.total / (totalValue || 1)) * 100)}% of book value`
            }))
          ]
        }}
      />
      <ScreenState state={lines.length === 0 ? "empty" : "ready"} title={t("journey.axis.empty")} body="AXIS has no cases to group.">
        <div className="flex flex-col gap-5">
          <div>{renderSection(bars, "axis")}</div>
        </div>
      </ScreenState>
      {top ? (
        <JourneyContinue
          to={`/journey/north?productLine=${encodeURIComponent(top.productLine)}`}
          label={`See NORTH's insight on ${top.productLine}`}
        />
      ) : null}
    </div>
  );
}
