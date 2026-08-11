import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import {
  budgetOf,
  campaignOrder,
  mainCurrency,
  moneyText,
  pacingOf,
  plannedMinor,
  spendByCampaign,
  type Pacing
} from "../../src/journeys";
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

// The marketer's cockpit (docs/08 §2): what is running and what it is spending.
// `?view=budget` serves the budget tab from the same data — the campaigns
// without a ceiling drop out and the rest rank purely by how close to theirs
// they are. Money is only ever totalled inside one currency (journeys.ts
// `mainCurrency`), because minor units from two are true in neither.

/** The window every spend figure on this screen is measured over. A phone shows
 *  the week the marketer is standing in, not the quarter. */
const WINDOW_DAYS = 7;

export default function Campaigns() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token, locale } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const budgetOnly = view === "budget";

  const page = useLoad(
    (signal) =>
      token
        ? Promise.all([
            queryRows(token, "signal/campaigns", { limit: 50 }, signal),
            queryRows(
              token,
              "signal/spend",
              { sort: "ts", from: Date.now() - WINDOW_DAYS * 86_400_000, limit: 200 },
              signal
            )
          ]).then(([campaigns, spend]) => ({ campaigns: campaigns.data, spend: spend.data }))
        : Promise.resolve({ campaigns: [] as Row[], spend: [] as Row[] }),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const campaigns = page.data?.campaigns ?? null;
  const spent = spendByCampaign(page.data?.spend ?? null);
  const rows = campaignOrder(campaigns, spent, WINDOW_DAYS, budgetOnly);
  const currency = mainCurrency(campaigns);
  const money = (minor: number) => moneyText(locale, currency, minor);
  // The headline totals only the campaigns the list is showing, in the one
  // currency they are being compared in.
  const inCurrency = rows.filter((row) => (budgetOf(row).currency ?? currency) === currency);
  const totalSpent = inCurrency.reduce((sum, row) => sum + (spent[row.id] ?? 0), 0);
  const totalPlanned = inCurrency.reduce(
    (sum, row) => sum + plannedMinor(budgetOf(row), WINDOW_DAYS),
    0
  );

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
          <Title chrome={chrome}>{t(budgetOnly ? "campaigns.budgetTitle" : "campaigns.title")}</Title>
          <Muted chrome={chrome}>{t("campaigns.window", { days: String(WINDOW_DAYS) })}</Muted>
          {rows.length ? (
            <Body chrome={chrome}>
              {totalPlanned > 0
                ? t("campaigns.total", { spent: money(totalSpent), planned: money(totalPlanned) })
                : t("campaigns.spent", { spent: money(totalSpent) })}
            </Body>
          ) : null}
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
            {t(budgetOnly ? "campaigns.budgetEmpty" : "campaigns.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const budget = budgetOf(item);
        const planned = plannedMinor(budget, WINDOW_DAYS);
        const pacing = pacingOf(spent[item.id] ?? 0, planned);
        const rowCurrency = budget.currency ?? currency;
        const amount =
          planned > 0
            ? t("campaigns.spentOf", {
                spent: moneyText(locale, rowCurrency, spent[item.id] ?? 0),
                planned: moneyText(locale, rowCurrency, planned)
              })
            : t("campaigns.noPlan");
        const state = t("campaigns.state", {
          state: humanize(String(item.state ?? "")),
          objective: humanize(String(item.objective ?? ""))
        });
        const name = typeof item.name === "string" && item.name ? item.name : item.id;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${name}, ${state}, ${amount}, ${t(`pacing.${pacing.state}`)}`}
            onPress={() => router.push(`/m/signal/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // The stripe is the pacing, read before any word is. Inline start
              // keeps it on the leading edge under RTL.
              borderStartWidth: 3,
              borderStartColor: stripeOf(pacing.state, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {name}
            </Body>
            <Muted chrome={chrome}>{state}</Muted>
            <Body chrome={chrome} style={{ color: pacing.state === "over" ? theme.danger : theme.muted }}>
              {`${t(`pacing.${pacing.state}`)} · ${amount}`}
            </Body>
            {pacing.ratio === null ? null : <Meter ratio={pacing.ratio} state={pacing.state} theme={theme} />}
          </Pressable>
        );
      }}
    />
  );
}

/** Spend against the ceiling as one bar. It is decoration over the words above
 *  it — the same fact is already readable without colour (WCAG 1.4.1). */
function Meter({
  ratio,
  state,
  theme
}: {
  ratio: number;
  state: Pacing;
  theme: { danger: string; accent: string; muted: string; border: string };
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: "hidden" }}
    >
      <View
        style={{
          width: `${Math.min(100, Math.round(ratio * 100))}%`,
          height: "100%",
          backgroundColor: stripeOf(state, theme)
        }}
      />
    </View>
  );
}

/** Pacing as a colour. Only overspend earns the danger token — if everything is
 *  red, nothing is. */
function stripeOf(
  state: Pacing,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (state === "over") return theme.danger;
  if (state === "hot") return theme.accent;
  if (state === "on") return theme.muted;
  return theme.border;
}
