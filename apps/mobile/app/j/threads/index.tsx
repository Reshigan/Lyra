import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../../src/api";
import { humanize } from "../../../src/rows";
import { useSession } from "../../../src/session";
import { RADIUS, SPACE, TOUCH_TARGET } from "../../../src/theme";
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
} from "../../../src/ui";
import { useLoad } from "../../../src/useLoad";

// The pocket console's front door: the conversations a human still owns, newest
// activity first. Bot-handled threads are excluded — an agent opening this on a
// phone is looking for the ones waiting on a person.

export default function Threads() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(
            token,
            "orbit/conversations",
            { state: "human,bot", sort: "lastMessageAt", order: "desc", limit: 50 },
            signal
          )
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const rows = page.data?.data ?? [];

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
          <Title chrome={chrome}>{t("thread.title")}</Title>
          {page.loading ? <Muted chrome={chrome}>{t("app.loading")}</Muted> : null}
          {page.error ? (
            <>
              <Notice
                chrome={chrome}
                message={t(errorKeyFor(page.error))}
                requestId={requestIdOf(page.error)}
              />
              <Button
                chrome={chrome}
                variant="quiet"
                label={t("error.retry")}
                onPress={page.reload}
              />
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        page.loading || page.error ? null : (
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {t("thread.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const summary = typeof item.summary === "string" && item.summary ? item.summary : null;
        const line = t("thread.state", {
          state: humanize(String(item.state ?? "")),
          channel: humanize(String(item.channel ?? ""))
        });
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={summary ? `${summary}, ${line}` : line}
            onPress={() => router.push(`/j/threads/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome}>{summary ?? item.id}</Body>
            <Muted chrome={chrome}>{line}</Muted>
          </Pressable>
        );
      }}
    />
  );
}
