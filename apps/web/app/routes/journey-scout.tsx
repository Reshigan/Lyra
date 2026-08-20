import { Hero, ScreenState, renderSection, hueVar, type Section } from "@lyra/ui";
import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { JourneyNav, JourneyContinue } from "../components/journey-nav";
import { translator, DEFAULT_LOCALE } from "../i18n";
import { useShellData } from "./workspace";

interface WhitespaceCommentary {
  whitespaceId: string;
  category: string | null;
  status: string;
  commentary: string | null;
  why: string[];
  ai: { marker: string; auditId: string; model: string; provider: string; tier: string; at: string } | null;
  suppressed: boolean;
}

interface CategoryGroup {
  category: string;
  count: number;
}

const COMMENTARY_LIMIT = 50;

function matches(category: string | null, productLine: string): boolean {
  if (!category || !productLine) return false;
  const a = category.toLowerCase();
  const b = productLine.toLowerCase();
  return a.includes(b) || b.includes(a);
}

function groupKey(row: WhitespaceCommentary): string {
  return row.category ?? `Status: ${row.status}`;
}

function groupByCategory(rows: WhitespaceCommentary[]): CategoryGroup[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = groupKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const productLine = url.searchParams.get("productLine") ?? "";
  const page = await api<{ data: WhitespaceCommentary[] }>(
    `/v1/scout/whitespaces/commentary?limit=${COMMENTARY_LIMIT}`,
    { env, request }
  );
  const rows = page.data.filter((r) => !r.suppressed);
  const ranked = [...rows].sort((a, b) => Number(matches(b.category, productLine)) - Number(matches(a.category, productLine)));
  return { rows: ranked, productLine };
}

export default function JourneyScout({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { rows, productLine } = loaderData;
  const shell = useShellData();
  const t = translator(shell?.locale ?? DEFAULT_LOCALE, shell?.overrides);
  const top = rows[0] ?? null;
  const groups = groupByCategory(rows);
  const maxCount = Math.max(1, ...groups.map((g) => g.count));

  const quadrant: Section = {
    kind: "radar",
    title: "Whitespace opportunity by grouping",
    xlab: "rarer → more opportunity",
    ylab: "commentary coverage →",
    items: groups.map((g) => {
      const inCategory = rows.filter((r) => groupKey(r) === g.category);
      const covered = inCategory.filter((r) => r.commentary).length;
      const rarity = 100 - Math.round((g.count / maxCount) * 100);
      const coverage = Math.round((covered / g.count) * 100);
      return {
        label: `${g.category} (${g.count})`,
        x: `${Math.min(92, Math.max(4, rarity))}%`,
        y: `${Math.min(92, Math.max(4, coverage))}%`,
        size: `${Math.max(14, Math.round((g.count / maxCount) * 40))}px`,
        trail: hueVar("scout"),
        hue: hueVar("scout")
      };
    })
  };

  const table: Section = {
    kind: "rows",
    title: "Whitespace commentary",
    headers: [
      { label: "Category", align: "left" },
      { label: "Status", align: "left" },
      { label: "Commentary", align: "left" }
    ],
    items: rows.slice(0, 12).map((row) => ({
      cells: [
        { v: row.category ?? "—", badge: true, plain: false, align: "left", font: "", size: "", hue: hueVar("scout"), bg: "", line: "" },
        { v: row.status, badge: false, plain: true, align: "left", font: "", size: "", hue: "var(--text)", bg: "", line: "" },
        { v: row.commentary ?? "—", badge: false, plain: true, align: "left", font: "", size: "", hue: "var(--text)", bg: "", line: "" }
      ]
    }))
  };

  const why: Section = {
    kind: "callout",
    title: top ? `Why "${top.category ?? "this"}"` : "Why",
    items: (top?.why ?? []).map((reason, i) => ({
      code: String(i + 1).padStart(2, "0"),
      hue: hueVar("scout"),
      body: reason
    }))
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <JourneyNav current="scout" t={t} />
      <Hero
        eyebrow="SCOUT"
        title={t("journey.scout.title")}
        sub={
          productLine
            ? `Ranking ${rows.length} whitespace item${rows.length === 1 ? "" : "s"} against AXIS/NORTH's line: ${productLine}.`
            : `${rows.length} open whitespace item${rows.length === 1 ? "" : "s"} across ${groups.length} grouping${groups.length === 1 ? "" : "s"}.`
        }
        mod="scout"
        {...(rows.length > 0
          ? {
              hero: {
                chips: [
                  { label: "Open whitespace", value: String(rows.length), hue: hueVar("scout") },
                  ...groups.map((g) => ({
                    label: g.category,
                    value: String(g.count),
                    hue: hueVar("scout"),
                    detail: `${Math.round((g.count / rows.length) * 100)}% of open whitespace${
                      top && g.category === groupKey(top) && top.commentary ? ` — ${top.commentary}` : ""
                    }`
                  }))
                ]
              }
            }
          : {})}
      />
      <ScreenState
        state={rows.length === 0 ? "empty" : "ready"}
        title={t("journey.scout.empty")}
        body="SCOUT has not surfaced any commentary yet."
      >
        <div className="flex flex-col gap-5">
          {groups.length > 1 ? <div>{renderSection(quadrant, "scout")}</div> : null}
          <div>{renderSection(table, "scout")}</div>
          {top && top.why.length > 0 ? <div>{renderSection(why, "scout")}</div> : null}
        </div>
      </ScreenState>
      {top ? (
        <JourneyContinue
          to={`/journey/signal?subject=${encodeURIComponent(top.category ?? top.whitespaceId)}&whitespaceId=${encodeURIComponent(top.whitespaceId)}`}
          label={t("journey.scout.continue")}
        />
      ) : null}
    </div>
  );
}
