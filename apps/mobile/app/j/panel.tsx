import { FlatList, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import {
  deltaPct,
  indexText,
  latestPeriod,
  positionOf,
  rollByProvider,
  type PricePosition
} from "../../src/journeys";
import { fetchNames, shortRef, who, type Names } from "../../src/names";
import { useSession } from "../../src/session";
import { RADIUS, SPACE, TOUCH_TARGET } from "../../src/theme";
import {
  Body,
  Button,
  Loading,
  Muted,
  Notice,
  Title,
  errorKeyFor,
  requestIdOf,
  type Chrome
} from "../../src/ui";
import { useLoad } from "../../src/useLoad";

// Where our pricing sits against the panel, one row per provider, biggest book
// first — the phone half of the web bench (scout-panel.tsx). Only the latest
// period is shown: a phone answers "are we dear right now", and the history is
// a desk question. Every average is volume-weighted by the shared roll-up
// (journeys.ts `rollByProvider`), so the two surfaces cannot disagree.
//
// Rows do not open anything. A row here is a roll-up across several bench
// records, not a record, so there is nothing for a detail screen to show.

export default function Panel() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token, locale } = session;
  const insets = useSafeAreaInsets();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "scout/panel_bench", { sort: "period", order: "desc", limit: 200 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // A bench row carries a provider id and no name at all, so without this pass
  // the screen is a list of ULIDs. It degrades to short refs rather than
  // holding the list up.
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(
            token,
            page.data.data.map((row) => (typeof row.providerId === "string" ? row.providerId : null)),
            signal
          )
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const bench = page.data?.data ?? null;
  const period = latestPeriod(bench);
  const rows = rollByProvider(bench, period);

  return (
    <FlatList
      data={rows}
      keyExtractor={(roll) => roll.providerId}
      contentContainerStyle={{
        gap: SPACE.md,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
      ListHeaderComponent={
        <View style={{ gap: SPACE.md, marginBottom: SPACE.xs }}>
          <Title chrome={chrome}>{t("panel.title")}</Title>
          {period ? <Muted chrome={chrome}>{t("panel.period", { period })}</Muted> : null}
          {page.loading ? <Muted chrome={chrome}>{t("app.loading")}</Muted> : null}
          {page.error ? (
            <>
              <Notice
                chrome={chrome}
                message={t(errorKeyFor(page.error))}
                requestId={requestIdOf(page.error)}
              />
              <Button chrome={chrome} variant="quiet" label={t("error.retry")} onPress={page.reload} />
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        page.loading || page.error ? null : (
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {t("panel.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const pct = deltaPct(item.ourIdx, item.marketIdx);
        const position = positionOf(pct);
        const provider = who(item.providerId, names) ?? shortRef(item.providerId);
        const standing =
          pct === null
            ? t(`panel.${position}`)
            : t("panel.against", {
                position: t(`panel.${position}`),
                pct: Math.abs(pct).toFixed(1)
              });
        const index = indexText(item.ourIdx, locale);
        const market = indexText(item.marketIdx, locale);
        const book = t("panel.book", {
          share: String(Math.round(item.share * 100)),
          volume: String(item.volume),
          win: item.winRate === null ? t("panel.noWin") : `${item.winRate}%`
        });
        return (
          <View
            accessible
            accessibilityLabel={[provider, standing, book, item.lines.join(", ")]
              .filter(Boolean)
              .join(", ")}
            style={{
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // How our price sits, read before any word is.
              borderStartWidth: 3,
              borderStartColor: stripeOf(position, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: theme.surface
            }}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {provider}
            </Body>
            {item.lines.length ? <Muted chrome={chrome}>{item.lines.join(" · ")}</Muted> : null}
            <Body chrome={chrome} style={{ color: position === "dearer" ? theme.danger : theme.muted }}>
              {index && market ? `${standing} · ${index} / ${market}` : standing}
            </Body>
            <Muted chrome={chrome}>{book}</Muted>
          </View>
        );
      }}
    />
  );
}

/** Where we sit, as a colour. Only pricing above the panel earns the danger
 *  token — being cheap is a margin question, not an alarm. */
function stripeOf(
  position: PricePosition,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (position === "dearer") return theme.danger;
  if (position === "cheaper") return theme.accent;
  if (position === "atMarket") return theme.muted;
  return theme.border;
}
