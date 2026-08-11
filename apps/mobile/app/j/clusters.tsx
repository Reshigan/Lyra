import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { clusterOrder } from "../../src/journeys";
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

// The product person's radar (docs/08 §2), as a phone can hold it: the themes
// SCOUT has clustered, loudest first. The web radar (scout-radar.tsx) plots
// whitespace against momentum on two axes; a phone gets the same ranking as a
// list, and the second axis lives on the whitespace tab next door.

export default function Clusters() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "scout/clusters", { sort: "momentumScore", order: "desc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const rows = clusterOrder(page.data?.data ?? null);

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
          <Title chrome={chrome}>{t("clusters.title")}</Title>
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
            {t("clusters.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const momentum = typeof item.momentumScore === "number" ? item.momentumScore : null;
        const label = typeof item.theme === "string" && item.theme ? item.theme : item.id;
        const summary = typeof item.summary === "string" ? item.summary : null;
        const measure = t("clusters.measure", {
          momentum: momentum === null ? t("clusters.noScore") : String(Math.round(momentum)),
          size: String(typeof item.size === "number" ? item.size : 0)
        });
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[label, summary, measure].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/scout-clusters/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Momentum on the leading edge, read before any word is.
              borderStartWidth: 3,
              borderStartColor: heatOf(momentum, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {label}
            </Body>
            {summary ? (
              <Muted chrome={chrome} numberOfLines={2}>
                {summary}
              </Muted>
            ) : null}
            <Body chrome={chrome} style={{ color: theme.muted }}>
              {measure}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** Momentum as a colour. A rising theme is an opportunity, not an alarm, so the
 *  danger token stays out of this screen entirely. */
function heatOf(
  momentum: number | null,
  theme: { accent: string; muted: string; border: string }
): string {
  if (momentum === null) return theme.border;
  if (momentum >= 70) return theme.accent;
  if (momentum >= 40) return theme.muted;
  return theme.border;
}
