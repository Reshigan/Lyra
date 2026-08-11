import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { OPEN_CASE_STATUSES, caseSeverity, dueIn, queueOrder } from "../../src/journeys";
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

// The ops persona's front door (docs/08 §2): the open cases, worst first. The
// same screen serves the SLA tab with `?filter=sla`, which drops everything a
// deadline is not pressing on — the ranking is one function shared with the web
// queue (journeys.ts `caseSeverity`), so the two surfaces never disagree about
// which case is worst.

export default function Queue() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const slaOnly = filter === "sla";

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(
            token,
            "axis/cases",
            {
              status: OPEN_CASE_STATUSES.join(","),
              sort: "slaDueAt",
              order: "asc",
              limit: 50
            },
            signal
          )
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  // Read once per render, not per row: two rows a millisecond apart must not
  // land in different severity buckets while the list is being built.
  const now = Date.now();
  const rows = queueOrder(page.data?.data ?? null, now, slaOnly);

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
          <Title chrome={chrome}>{t(slaOnly ? "queue.slaTitle" : "queue.title")}</Title>
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
            {t(slaOnly ? "queue.slaEmpty" : "queue.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const severity = caseSeverity(item, now);
        const clock = dueIn(item.slaDueAt, now);
        const deadline = clock
          ? t(clock.overdue ? "queue.overdue" : "queue.dueIn", { hours: String(clock.hours) })
          : t("queue.noDeadline");
        const state = t("queue.state", {
          kind: humanize(String(item.kind ?? "")),
          status: humanize(String(item.status ?? ""))
        });
        const ref = typeof item.ref === "string" && item.ref ? item.ref : item.id;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${ref}, ${state}, ${t(`severity.${severity}`)}, ${deadline}`}
            onPress={() => router.push(`/m/axis/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // The stripe is the severity, read before any word is. It sits on
              // the inline start so it stays leading edge under RTL.
              borderStartWidth: 3,
              borderStartColor: stripeOf(severity, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {ref}
            </Body>
            <Muted chrome={chrome}>{state}</Muted>
            <Body
              chrome={chrome}
              style={{ color: severity === "breach" ? theme.danger : theme.muted }}
            >
              {`${t(`severity.${severity}`)} · ${deadline}`}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** Severity as a colour. Only a breach earns the danger token — if everything
 *  is red, nothing is. */
function stripeOf(
  severity: ReturnType<typeof caseSeverity>,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (severity === "breach") return theme.danger;
  if (severity === "urgent") return theme.accent;
  if (severity === "due") return theme.muted;
  return theme.border;
}
