import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import { moneyText, txnOrder, txnStanding, type TxnStanding } from "../../src/journeys";
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

// The controller's first tab: money that has not landed. The web ledger shows
// every transaction ever posted; a phone shows the ones a person can still do
// something about, so `txnOrder` drops the settled and reversed and puts what
// broke at the top (journeys.ts).
//
// A row opens the generic detail view — the journal lines, the transitions and
// the failure detail live there, and those are what someone who tapped a
// stalled payment came for.

export default function Money() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { locale, t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(token, "ledger/txns", { sort: "createdAt", order: "desc", limit: 50 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const now = Date.now();
  const rows = txnOrder(page.data?.data ?? null, now);

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
          <Title chrome={chrome}>{t("money.title")}</Title>
          <Muted chrome={chrome}>{t("money.intro")}</Muted>
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
            {t("money.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const standing = txnStanding(item, now);
        // Currency is per transaction on this table, not per tenant — a
        // reinsurance settlement is not in the same money as a premium.
        const amount = moneyText(
          locale,
          String(item.currency ?? "ZAR"),
          typeof item.grossMinor === "number" ? item.grossMinor : 0
        );
        const type = humanize(String(item.type ?? ""));
        const state = humanize(String(item.state ?? ""));
        // The failure code is the whole answer on a broken row, and nowhere
        // else on this card would carry it.
        const why =
          standing === "broken" && item.failureCode
            ? t("money.failed", { code: humanize(String(item.failureCode)) })
            : standing === "stalled"
              ? t("money.stalled")
              : null;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[type, amount, state, why].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/ledger/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Standing on the leading edge, read before any word is.
              borderStartWidth: 3,
              borderStartColor: stripeOf(standing, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {amount}
            </Body>
            <Muted chrome={chrome}>{type}</Muted>
            <Body
              chrome={chrome}
              style={{ color: standing === "broken" || standing === "stalled" ? theme.danger : theme.muted }}
            >
              {why ? `${state} · ${why}` : state}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** Standing as a colour. Only money that stopped earns the danger token — a
 *  transaction still moving is not a problem, it is a Tuesday. */
function stripeOf(
  standing: TxnStanding,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (standing === "broken" || standing === "stalled") return theme.danger;
  if (standing === "waiting") return theme.accent;
  return theme.border;
}
