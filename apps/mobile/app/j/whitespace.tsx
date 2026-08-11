import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { byId, opportunityOf, whitespaceOrder } from "../../src/journeys";
import { humanize } from "../../src/rows";
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

// The gaps SCOUT has found, best bet first. The web radar (scout-radar.tsx)
// draws these as dots on two axes — an open market across, the linked cluster's
// momentum up. A phone has no room for a scatter plot, so the same two numbers
// rank the list instead (journeys.ts `opportunityOf`), and the rows that cannot
// be plotted sit at the bottom saying why rather than disappearing.

export default function Whitespace() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? Promise.all([
            queryRows(token, "scout/whitespaces", { limit: 50 }, signal),
            queryRows(token, "scout/clusters", { limit: 50 }, signal)
          ]).then(([whitespaces, clusters]) => ({
            whitespaces: whitespaces.data,
            clusters: clusters.data
          }))
        : Promise.resolve({ whitespaces: [] as Row[], clusters: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const clusters = page.data?.clusters ?? null;
  const index = byId(clusters);
  const rows = whitespaceOrder(page.data?.whitespaces ?? null, clusters);
  const unplotted = rows.filter((row) => !opportunityOf(row, index).plotted).length;

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{
        gap: SPACE.md,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
      ListHeaderComponent={
        <View style={{ gap: SPACE.md, marginBottom: SPACE.xs }}>
          <Title chrome={chrome}>{t("whitespace.title")}</Title>
          {unplotted ? (
            <Muted chrome={chrome}>{t("whitespace.unplotted", { count: String(unplotted) })}</Muted>
          ) : null}
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
            {t("whitespace.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const spot = opportunityOf(item, index);
        const description =
          typeof item.description === "string" && item.description ? item.description : item.id;
        const status = t("whitespace.status", {
          status: humanize(String(item.status ?? "")),
          category: humanize(String(item.category ?? ""))
        });
        const measure = spot.plotted
          ? t("whitespace.measure", {
              fit: String(Math.round(spot.fit ?? 0)),
              momentum: String(Math.round(spot.momentum ?? 0))
            })
          : t("whitespace.unlinked");
        const evidence = spot.evidence
          ? t("whitespace.evidence", { count: String(spot.evidence) })
          : null;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[description, status, measure, evidence].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/scout-whitespaces/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Strength of the bet on the leading edge, read before any word is.
              borderStartWidth: 3,
              borderStartColor: heatOf(spot.plotted ? spot.score : null, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }} numberOfLines={2}>
              {description}
            </Body>
            <Muted chrome={chrome}>{status}</Muted>
            <Body chrome={chrome} style={{ color: theme.muted }}>
              {evidence ? `${measure} · ${evidence}` : measure}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** How strong the bet is, as a colour. A gap in the market is an opportunity,
 *  not an alarm, so the danger token stays out of this screen entirely. */
function heatOf(score: number | null, theme: { accent: string; muted: string; border: string }): string {
  if (score === null) return theme.border;
  if (score >= 50) return theme.accent;
  if (score >= 25) return theme.muted;
  return theme.border;
}
