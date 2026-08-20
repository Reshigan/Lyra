import { Hero, ScreenState, renderSection, hueVar, type Section } from "@lyra/ui";
import type { LoaderFunctionArgs } from "react-router";
import { api } from "../api.server";
import { cloudflare } from "../context";
import { JourneyNav, JourneyContinue } from "../components/journey-nav";
import { translator, DEFAULT_LOCALE } from "../i18n";
import { humanise } from "../modules/spec";
import { chosen, narrative, parsed } from "./north-shared";
import { useShellData } from "./workspace";

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

/**
 * One entry of `highlightsJson`, mirroring `Highlight` in
 * apps/web/app/routes/north-brief.tsx — which in turn mirrors what
 * apps/api/src/engines/narrator.ts writes. `note` is the sentence a reader
 * wants here; north-brief renders the figure and its delta instead, so it has
 * no field for it.
 *
 * This screen used to declare the column as `string[]` and filter for strings,
 * which matched nothing the server has ever sent: every briefing read zero
 * highlights. Third sighting of the assumed-contract bug (see CLAUDE.md on
 * whitespace-commentary and labelsFrom) — hence the comment naming the file
 * this type mirrors.
 */
interface Highlight {
  metricKey: string;
  period: string;
  value: number;
  deltaBps: number | null;
  note?: string;
}

const BRIEFING_HISTORY_LIMIT = 12;

export function highlightsOf(row: BriefingRow | null | undefined): Highlight[] {
  const list = parsed<unknown>(row?.highlightsJson, []);
  if (!Array.isArray(list)) return [];
  return list.filter((h): h is Highlight => typeof h === "object" && h !== null && "metricKey" in h);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflare).env;
  const url = new URL(request.url);
  const productLine = url.searchParams.get("productLine") ?? "";
  const page = await api<{ data: BriefingRow[] }>(
    `/v1/north/briefings?limit=${BRIEFING_HISTORY_LIMIT}&sort=createdAt&order=desc`,
    { env, request }
  );
  // The pick happens in the component: which briefing is readable depends on
  // the reader's locale, and the shell knows that, the loader does not.
  const history = [...page.data].reverse();
  return { briefings: page.data, productLine, history };
}

export default function JourneyNorth({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { briefings, productLine, history } = loaderData;
  const shell = useShellData();
  const locale = shell?.locale ?? DEFAULT_LOCALE;
  const t = translator(locale, shell?.overrides);

  const briefing = chosen(briefings, null, locale);

  const highlights = highlightsOf(briefing);
  const prose = narrative(briefing?.narrativeRef);

  const trendCounts = history.map((row) => highlightsOf(row).length);
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
    items: prose ? [{ body: prose }] : []
  };

  const notes: Section = {
    kind: "notes",
    title: "Highlights",
    items: highlights.map((h) => ({
      hue: hueVar("north"),
      label: humanise(h.metricKey),
      body: h.note ?? `${h.period}`
    }))
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <JourneyNav current="north" t={t} />
      <Hero
        eyebrow="NORTH"
        title={t("journey.north.title")}
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
        title={t("journey.north.empty")}
        body="NORTH has not generated a briefing yet — generate one from /north/brief first."
      >
        <div className="flex flex-col gap-5">
          {history.length > 1 ? <div>{renderSection(trend, "north")}</div> : null}
          <div>{renderSection(kv, "north")}</div>
          {prose ? <div>{renderSection(text, "north")}</div> : null}
          {highlights.length > 0 ? <div>{renderSection(notes, "north")}</div> : null}
        </div>
      </ScreenState>
      {briefing ? (
        <JourneyContinue
          to={`/journey/scout?productLine=${encodeURIComponent(productLine)}&briefingId=${encodeURIComponent(briefing.id)}`}
          label={t("journey.north.continue")}
        />
      ) : null}
    </div>
  );
}
