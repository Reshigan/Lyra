import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listRows, type Row } from "../../../src/api";
import { labelKeyFor, resourceForNavKey } from "../../../src/nav";
import { subtitleOf, titleOf } from "../../../src/rows";
import { useSession } from "../../../src/session";
import { RADIUS, SPACE, TEXT, TOUCH_TARGET } from "../../../src/theme";
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

// One screen for every workspace. `/v1/{module}/{resource}` answers in the same
// `{ data: [...] }` shape for all of them (apps/api/src/crud.ts), so there is
// nothing here that knows which module it is showing beyond the nav mapping and
// the label key.

export default function ModuleList() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { nav } = useLocalSearchParams<{ nav: string }>();
  const resource = resourceForNavKey(nav ?? "");

  const page = useLoad(
    (signal) =>
      token && resource
        ? listRows(token, resource, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token, resource]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const heading = t(labelKeyFor(`/${nav ?? ""}`));
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
          <Title chrome={chrome}>{heading}</Title>
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
          {!page.loading && !page.error && rows.length > 0 ? (
            <Muted chrome={chrome}>{t("list.count", { n: rows.length })}</Muted>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        page.loading || page.error ? null : (
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {resource ? t("list.empty") : t("nav.unavailable")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const title = titleOf(item) ?? t("list.untitled");
        const subtitle = subtitleOf(item);
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
            onPress={() => router.push(`/m/${nav}/${encodeURIComponent(item.id)}`)}
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
            <Text
              numberOfLines={2}
              style={{ color: theme.text, fontSize: TEXT.s16, writingDirection: session.dir }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={{ color: theme.muted, fontSize: TEXT.s13, writingDirection: session.dir }}>
                {subtitle}
              </Text>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
