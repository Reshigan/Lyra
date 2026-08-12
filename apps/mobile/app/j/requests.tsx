import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { daysUntil, dsarOrder, dsarStanding, type DsarStanding } from "../../src/journeys";
import { fetchNames, shortRef, who, type Names } from "../../src/names";
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

// The compliance officer's first tab (J-C4 / J-CO1): data-subject requests
// against a statutory clock. `dueAt` is a deadline set by law, not by a target
// somebody chose, so a late row is the loudest thing on the screen and the
// order is soonest-due first (journeys.ts `dsarOrder`).
//
// Closed requests stay in the list rather than being filtered out the way
// renewals are: a refusal has to be defensible afterwards, and the officer
// checking one is the officer holding this phone.

export default function Requests() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "compliance/dsar-requests", { sort: "dueAt", order: "asc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // A request carries a customer id and nothing else a person can read.
  // Resolved after the list loads, degraded to a short ref rather than holding
  // it up (names.ts) — and `subjectIdentifier` is never rendered here: it is
  // the subject's own email or ID number, and this is a scanning list.
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(
            token,
            page.data.data.map((row) => (typeof row.customerId === "string" ? row.customerId : null)),
            signal
          )
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const now = Date.now();
  const rows = dsarOrder(page.data?.data ?? null, now);

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
          <Title chrome={chrome}>{t("requests.title")}</Title>
          <Muted chrome={chrome}>{t("requests.intro")}</Muted>
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
            {t("requests.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const standing = dsarStanding(item, now);
        const days = daysUntil(item.dueAt, now);
        const when =
          standing === "closed"
            ? t("requests.closed")
            : days === null
              ? t("requests.noDue")
              : days < 0
                ? t("requests.overdue", { days: String(-days) })
                : t("requests.dueIn", { days: String(days) });
        const subject =
          who(typeof item.customerId === "string" ? item.customerId : null, names) ?? shortRef(item.id);
        const kind = t("requests.kind", {
          type: humanize(String(item.type ?? "")),
          channel: humanize(String(item.channel ?? ""))
        });
        const state = humanize(String(item.state ?? ""));
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[subject, kind, state, when].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/compliance/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // The clock on the leading edge, read before any word is.
              borderStartWidth: 3,
              borderStartColor: stripeOf(standing, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {subject}
            </Body>
            <Muted chrome={chrome}>{kind}</Muted>
            <Body chrome={chrome} style={{ color: standing === "late" ? theme.danger : theme.muted }}>
              {`${state} · ${when}`}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** Standing as a colour. Only a missed statutory deadline earns the danger
 *  token — a request due next month is work, not an incident. */
function stripeOf(
  standing: DsarStanding,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (standing === "late") return theme.danger;
  if (standing === "due") return theme.accent;
  if (standing === "open") return theme.muted;
  return theme.border;
}
