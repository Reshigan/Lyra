import { Hero, ScreenState, renderSection, hueVar, type Section } from "@lyra/ui";
import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { JourneyNav, JourneyContinue } from "../components/journey-nav";

interface BriefingRow {
  id: string;
  date: string;
  audience: string;
  locale: string;
  narrativeRef: string;
  highlightsJson: unknown;
  status: string;
  createdAt: number;
}

const BRIEFING_HISTORY_LIMIT = 12;

function highlightsCount(row: BriefingRow): number {
  return Array.isArray(row.highlightsJson) ? row.highlightsJson.filter((h) => typeof h === "string").length : 0;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const productLine = url.searchParams.get("productLine") ?? "";
  const page = await api<{ data: BriefingRow[] }>(
    `/v1/north/briefings?limit=${BRIEFING_HISTORY_LIMIT}&sort=createdAt&order=desc`,
    { env, request }
  );
  const briefing = page.data[0] ?? null;
  const history = [...page.data].reverse();
  return { briefing, productLine, history };
}

export default function JourneyNorth({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { briefing, productLine, history } = loaderData;

  const highlights = Array.isArray(briefing?.highlightsJson)
    ? (briefing.highlightsJson as unknown[]).filter((h): h is string => typeof h === "string")
    : [];

  const trendCounts = history.map(highlightsCount);
  const maxTrend = Math.max(1, ...trendCounts);

  const trend: Section = {
    kind: "spark",
    title: "Highlights per briefing",
    items: history.map((row, i) => ({
      h: `${Math.max(6, Math.round(((trendCounts[i] ?? 0) / maxTrend) * 100))}%`,
      hue: hueVar("north"),
      label: trendCounts[i] ?? 0
    })),
    from: history[0]?.date ?? "",
    mid: history[Math.floor(history.length / 2)]?.date ?? "",
    to: history[history.length - 1]?.date ?? ""
  };

  const kv: Section = {
    kind: "kv",
    title: "Briefing",
    items: briefing
      ? [
          { label: "Date", value: briefing.date, hue: "var(--text)", font: "" },
          { label: "Audience", value: briefing.audience, hue: "var(--text)", font: "" },
          { label: "Status", value: briefing.status, hue: hueVar("north"), font: "" },
          { label: "Locale", value: briefing.locale, hue: "var(--text)", font: "" }
        ]
      : []
  };

  const text: Section = {
    kind: "text",
    title: "Narrative",
    items: briefing ? [{ body: briefing.narrativeRef }] : []
  };

  const notes: Section = {
    kind: "notes",
    title: "Highlights",
    items: highlights.map((h) => ({ hue: hueVar("north"), label: "", body: h }))
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <JourneyNav current="north" />
      <Hero
        eyebrow="NORTH"
        title="Insight, carried from AXIS"
        sub={
          productLine
            ? `Reading AXIS's leading product line: ${productLine}.`
            : briefing
              ? `Latest briefing for ${briefing.audience}, ${highlights.length} highlight${highlights.length === 1 ? "" : "s"}.`
              : "Latest briefing on file."
        }
        mod="north"
        {...(briefing
          ? {
              hero: {
                chips: [
                  { label: "Highlights", value: String(highlights.length), hue: hueVar("north") },
                  { label: "Briefing status", value: briefing.status, hue: hueVar("north") },
                  { label: "Audience", value: briefing.audience, hue: hueVar("north"), detail: `Locale: ${briefing.locale}` },
                  { label: "Date", value: briefing.date, hue: hueVar("north") }
                ]
              }
            }
          : {})}
      />
      <ScreenState
        state={briefing ? "ready" : "empty"}
        title="No briefing yet"
        body="NORTH has not generated a briefing yet — generate one from /north/brief first."
      >
        <div className="flex flex-col gap-5">
          {history.length > 1 ? <div>{renderSection(trend, "north")}</div> : null}
          <div>{renderSection(kv, "north")}</div>
          <div>{renderSection(text, "north")}</div>
          {highlights.length > 0 ? <div>{renderSection(notes, "north")}</div> : null}
        </div>
      </ScreenState>
      {briefing ? (
        <JourneyContinue
          to={`/journey/scout?productLine=${encodeURIComponent(productLine)}&briefingId=${encodeURIComponent(briefing.id)}`}
          label="See SCOUT's whitespace"
        />
      ) : null}
    </div>
  );
}
