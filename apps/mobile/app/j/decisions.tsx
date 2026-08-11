import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import type { MessageKey } from "../../src/i18n";
import { daysUntil, decisionOrder, optionCount } from "../../src/journeys";
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

// The decision log (docs/08 §2, the exec's and the board's third tab): what was
// chosen, by whom, and what is due to be looked at again. There is no web route
// for this one, so the order is authored in journeys.ts `decisionOrder` and
// tested there — open decisions first, soonest review at the top.

/** The three states north_decisions records (packages/db/src/schema/north.ts). */
const STATUS_KEYS: Record<string, MessageKey> = {
  open: "decisions.open",
  reviewed: "decisions.reviewed",
  reversed: "decisions.reversed"
};

export default function Decisions() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "north/decisions", { sort: "reviewAt", order: "asc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // `owner` is a user id, so without this pass every card is signed by a ULID.
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(
            token,
            page.data.data.map((row) => (typeof row.owner === "string" ? row.owner : null)),
            signal
          )
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const now = Date.now();
  const rows = decisionOrder(page.data?.data ?? null, now);

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
          <Title chrome={chrome}>{t("decisions.title")}</Title>
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
            {t("decisions.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const status = String(item.status ?? "");
        const open = status === "open";
        const days = daysUntil(item.reviewAt, now);
        const due =
          days === null
            ? open
              ? t("decisions.noReview")
              : null
            : days < 0
              ? t("decisions.reviewOverdue", { days: String(-days) })
              : t("decisions.reviewIn", { days: String(days) });
        const overdue = open && days !== null && days < 0;
        const title = String(item.title ?? "") || shortRef(item.id);
        const owner = who(typeof item.owner === "string" ? item.owner : null, names);
        const options = optionCount(item);
        const chosen =
          typeof item.chosen === "string" && item.chosen
            ? t("decisions.chosen", { option: item.chosen })
            : t("decisions.undecided");
        const weighed = options ? t("decisions.options", { count: String(options) }) : null;
        // A status this build has no word for still has to read as something,
        // so an unknown one degrades to the humanized code rather than a key.
        const label = STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : humanize(status);
        const standing = [label, owner].filter(Boolean).join(" · ");
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[title, standing, chosen, weighed, due].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/north-decisions/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Whether this one still wants attention, read before any word is.
              borderStartWidth: 3,
              borderStartColor: overdue ? theme.danger : open ? theme.accent : theme.border,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }} numberOfLines={2}>
              {title}
            </Body>
            {standing ? <Muted chrome={chrome}>{standing}</Muted> : null}
            <Muted chrome={chrome} numberOfLines={2}>
              {weighed ? `${chosen} · ${weighed}` : chosen}
            </Muted>
            {due ? (
              <Body chrome={chrome} style={{ color: overdue ? theme.danger : theme.muted }}>
                {due}
              </Body>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
