import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { hoursSince } from "../../src/journeys";
import { fetchNames, who, type Names } from "../../src/names";
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

// The admin's third tab: who did what, newest first. `core_audit_log` is
// append-only and has no createdAt, so the sort is on `ts` explicitly — the
// same thing customer-360.tsx does on the web.
//
// Actions are an open set of `module.resource.verb` codes, so they are
// humanized rather than translated through a label table nobody maintains
// (the rule customer-360.tsx already records). A code this app has never seen
// still reads as words.
//
// A row opens: the generic detail view is where the ip, user agent and chain
// hashes live, and those are exactly what an admin checking a suspicious entry
// on a phone came for.

/** Anything older than a day reads in days — an audit tab is scanned for what
 *  happened recently, and "37 hours ago" is arithmetic the reader shouldn't do. */
const DAY = 24;

export default function Audit() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = Date.now();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "core/audit-log", { sort: "ts", order: "desc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // Actors are `user:us_…` refs on the wire. Resolved after the log loads, and
  // degraded to the short ref rather than holding the log up (names.ts).
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(token, page.data.data.map((row) => String(row.actorRef ?? "")), signal)
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

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
          <Title chrome={chrome}>{t("audit.title")}</Title>
          <Muted chrome={chrome}>{t("audit.intro")}</Muted>
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
            {t("audit.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const action = humanize(String(item.action ?? ""));
        const actor = who(String(item.actorRef ?? ""), names) ?? "";
        const hours = hoursSince(item.ts, now);
        const when =
          hours === null
            ? t("audit.noTime")
            : hours < 1
              ? t("audit.justNow")
              : hours < DAY
                ? t("audit.hoursAgo", { hours: String(hours) })
                : t("audit.daysAgo", { days: String(Math.floor(hours / DAY)) });
        const subject = item.subjectRef ? String(item.subjectRef) : null;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[action, t("audit.by", { name: actor }), when]
              .filter(Boolean)
              .join(", ")}
            onPress={() => router.push(`/m/admin-audit/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Newest entries carry the accent; the rest of the day is quiet.
              borderStartWidth: 3,
              borderStartColor: hours !== null && hours < DAY ? theme.accent : theme.border,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }} numberOfLines={2}>
              {action}
            </Body>
            <Muted chrome={chrome}>
              {actor ? `${t("audit.by", { name: actor })} · ${when}` : when}
            </Muted>
            {subject ? <Muted chrome={chrome}>{t("audit.subject", { subject })}</Muted> : null}
          </Pressable>
        );
      }}
    />
  );
}
