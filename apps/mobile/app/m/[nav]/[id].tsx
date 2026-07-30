import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRow } from "../../../src/api";
import { resourceForNavKey } from "../../../src/nav";
import { fieldsOf, titleOf } from "../../../src/rows";
import { useSession } from "../../../src/session";
import { SPACE, TEXT } from "../../../src/theme";
import {
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

// Every field the API returns, in the order it returns them. There is no
// per-resource layout yet and inventing one here would be a design decision made
// in the wrong phase — showing everything is at least honest about the record.

export default function ModuleDetail() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const { nav, id } = useLocalSearchParams<{ nav: string; id: string }>();
  const resource = resourceForNavKey(nav ?? "");

  const row = useLoad(
    (signal) =>
      token && resource && id ? getRow(token, resource, id, signal) : Promise.resolve(null),
    [token, resource, id]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const record = row.data;

  return (
    <ScrollView
      contentContainerStyle={{
        gap: SPACE.lg,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
    >
      <Title chrome={chrome}>
        {(record && titleOf(record)) ?? t(row.loading ? "app.loading" : "detail.title")}
      </Title>

      {row.error ? (
        <>
          <Notice
            chrome={chrome}
            message={t(errorKeyFor(row.error))}
            requestId={requestIdOf(row.error)}
          />
          <Button chrome={chrome} variant="quiet" label={t("error.retry")} onPress={row.reload} />
        </>
      ) : null}

      {record ? (
        <View style={{ gap: SPACE.md }}>
          {fieldsOf(record).map((field) => (
            <View
              key={field.key}
              style={{
                gap: SPACE.xs,
                paddingBottom: SPACE.md,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.border
              }}
            >
              <Muted chrome={chrome}>{field.key}</Muted>
              <Text
                selectable
                style={{
                  color: theme.text,
                  fontSize: TEXT.s14,
                  lineHeight: TEXT.s14 * 1.5,
                  writingDirection: session.dir
                }}
              >
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
