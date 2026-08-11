import { FlatList, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import {
  cacMinor,
  channelLabel,
  ltvMinor,
  ltvToCac,
  moneyText,
  multipleText,
  rollByChannel
} from "../../src/journeys";
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

// The marketer's attribution tab (docs/08 §2): what each channel cost and what
// it actually won, over the last 30 days. The web screen (signal-analytics.tsx)
// offers 7/30/90 and a cohort table; a phone answers one question — is a
// channel paying for itself — so it takes the month and drops the rest.
//
// Every figure is derived, not fetched: no endpoint returns cost per
// acquisition. The derivations are the web ones (journeys.ts `rollByChannel`,
// `cacMinor`, `ltvToCac`), so a channel cannot look profitable on a phone and
// underwater on the desk.
//
// Rows do not open anything: a roll-up across a month of spend rows and touches
// is not a record, so there is nothing for a detail screen to show.

/** The web default window (signal.shared.ts `windowDays`). */
const DAYS = 30;

/** What the ledger is worth paying attention to below — under 1× the channel
 *  loses money on every customer it wins. */
const BREAK_EVEN = 1;

export default function Attribution() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token, locale } = session;
  const insets = useSafeAreaInsets();
  const from = Date.now() - DAYS * 86_400_000;

  const page = useLoad(
    (signal) =>
      token
        ? Promise.all([
            queryRows(token, "signal/spend", { sort: "ts", from, limit: 200 }, signal),
            queryRows(token, "signal/attribution-events", { sort: "ts", from, limit: 200 }, signal)
          ]).then(([spend, touches]) => ({ data: spend.data, touches: touches.data }))
        : Promise.resolve({ data: [] as Row[], touches: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const spend = page.data?.data ?? null;
  const touches = page.data?.touches ?? null;
  const rows = rollByChannel(spend, touches);
  // Minor units from two currencies added together are true in neither, so the
  // screen totals in the one the ledger is written in.
  const currency = typeof spend?.[0]?.currency === "string" ? spend[0].currency : "ZAR";
  const money = (minor: number) => moneyText(locale, currency, minor);

  const spentMinor = rows.reduce((sum, roll) => sum + roll.spendMinor, 0);
  const binds = rows.reduce((sum, roll) => sum + roll.binds, 0);
  const overall = ltvToCac(ltvMinor(touches), cacMinor(spentMinor, binds));

  return (
    <FlatList
      data={rows}
      keyExtractor={(roll) => roll.channel}
      contentContainerStyle={{
        gap: SPACE.md,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
      ListHeaderComponent={
        <View style={{ gap: SPACE.md, marginBottom: SPACE.xs }}>
          <Title chrome={chrome}>{t("attribution.title")}</Title>
          <Muted chrome={chrome}>
            {t("attribution.window", {
              days: String(DAYS),
              spend: money(spentMinor),
              won: String(binds)
            })}
          </Muted>
          {overall === null ? null : (
            <Body chrome={chrome} style={{ color: overall < BREAK_EVEN ? theme.danger : theme.muted }}>
              {t("attribution.overall", { ratio: multipleText(locale, overall) })}
            </Body>
          )}
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
            {t("attribution.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const cac = cacMinor(item.spendMinor, item.binds);
        const ratio = ltvToCac(item.binds ? Math.round(item.valueMinor / item.binds) : null, cac);
        const losing = ratio !== null && ratio < BREAK_EVEN;
        const channel = channelLabel(item.channel, locale);
        const cost =
          cac === null
            ? t("attribution.noWins")
            : t("attribution.cac", { cac: money(cac), won: String(item.binds) });
        const worth =
          ratio === null ? null : t("attribution.ratio", { ratio: multipleText(locale, ratio) });
        const traffic = t("attribution.traffic", {
          spend: money(item.spendMinor),
          clicks: String(item.clicks)
        });
        return (
          <View
            accessible
            accessibilityLabel={[channel, cost, worth, traffic].filter(Boolean).join(", ")}
            style={{
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Whether this channel pays for itself, read before any word is.
              borderStartWidth: 3,
              borderStartColor: losing ? theme.danger : ratio === null ? theme.border : theme.accent,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: theme.surface
            }}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {channel}
            </Body>
            <Muted chrome={chrome}>{traffic}</Muted>
            <Body chrome={chrome} style={{ color: losing ? theme.danger : theme.muted }}>
              {worth ? `${cost} · ${worth}` : cost}
            </Body>
          </View>
        );
      }}
    />
  );
}
