import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import type { MessageKey } from "../../src/i18n";
import { boardpackOrder, sectionCount } from "../../src/journeys";
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

// The board pack shelf (docs/08 §2): every pack that has been generated,
// newest period first, with how far through review each one got and who signed
// it off. Generating a pack is a desk job — it renders a PDF and an XLSX — so
// this tab reads the shelf and opens a pack, and does not offer to build one.

/** The four states north_boardpacks records (packages/db/src/schema/north.ts). */
const STATUS_KEYS: Record<string, MessageKey> = {
  draft: "boardpack.draft",
  review: "boardpack.review",
  final: "boardpack.final",
  distributed: "boardpack.distributed"
};

export default function Boardpack() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "north/boardpacks", { sort: "period", order: "desc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // `approvedBy` is a user id, and "approved by 01KE9…" is not an answer.
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(
            token,
            page.data.data.map((row) => (typeof row.approvedBy === "string" ? row.approvedBy : null)),
            signal
          )
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const rows = boardpackOrder(page.data?.data ?? null);

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
          <Title chrome={chrome}>{t("boardpack.title")}</Title>
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
            {t("boardpack.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const status = String(item.status ?? "");
        const title = String(item.title ?? "") || shortRef(item.id);
        const period = typeof item.period === "string" ? item.period : null;
        const label = STATUS_KEYS[status] ? t(STATUS_KEYS[status]) : humanize(status);
        const approver = who(typeof item.approvedBy === "string" ? item.approvedBy : null, names);
        const standing = approver ? t("boardpack.approvedBy", { who: approver, status: label }) : label;
        const sections = sectionCount(item);
        const contents = [
          sections ? t("boardpack.sections", { count: String(sections) }) : t("boardpack.noSections"),
          item.pdfFileId ? "PDF" : null,
          item.xlsxFileId ? "XLSX" : null
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[title, period, standing, contents].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/north-boardpacks/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // How finished the pack is, read before any word is. A draft is
              // quiet rather than alarming — nothing is wrong with a draft.
              borderStartWidth: 3,
              borderStartColor: status === "distributed" || status === "final" ? theme.accent : theme.border,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }} numberOfLines={2}>
              {title}
            </Body>
            {period ? <Muted chrome={chrome}>{period}</Muted> : null}
            <Body chrome={chrome} style={{ color: theme.muted }}>
              {standing}
            </Body>
            <Muted chrome={chrome}>{contents}</Muted>
          </Pressable>
        );
      }}
    />
  );
}
