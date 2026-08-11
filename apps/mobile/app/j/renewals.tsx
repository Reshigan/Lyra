import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, type Row } from "../../src/api";
import {
  OPEN_RENEWAL_STATES,
  daysUntil,
  renewalOrder,
  urgencyOf,
  type Urgency
} from "../../src/journeys";
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

// The CX agent's renewals tab (docs/08 §2): the policies still open to a call,
// soonest expiry first. The web board (orbit-pipeline.tsx) shows four stages
// side by side; a phone has one column, so it shows the two stages a call can
// still change and drops the history. Urgency is the shared rule (journeys.ts
// `urgencyOf`), so a card is never hot on one surface and calm on the other.

export default function Renewals() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const page = useLoad(
    (signal) =>
      token
        ? queryRows(
            token,
            "orbit/renewals",
            {
              state: OPEN_RENEWAL_STATES.join(","),
              sort: "expiryAt",
              order: "asc",
              limit: 50
            },
            signal
          )
        : Promise.resolve({ data: [] as Row[] }),
    [token]
  );

  // A renewal card carries a customer id and a policy ref and no text at all,
  // so without this pass the tab is a list of ULIDs. Runs after the page and
  // degrades to short refs rather than holding the list up.
  const resolved = useLoad(
    (signal) =>
      token && page.data
        ? fetchNames(
            token,
            page.data.data.flatMap((row) => [
              typeof row.customerId === "string" ? row.customerId : null,
              typeof row.policyRef === "string" ? row.policyRef : null
            ]),
            signal
          )
        : Promise.resolve({} as Names),
    [token, page.data]
  );
  const names = resolved.data ?? {};

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const now = Date.now();
  const rows = renewalOrder(page.data?.data ?? null, now);

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
          <Title chrome={chrome}>{t("renewals.title")}</Title>
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
            {t("renewals.empty")}
          </Body>
        )
      }
      renderItem={({ item }) => {
        const days = daysUntil(item.expiryAt, now);
        const urgency = urgencyOf(days);
        const when =
          days === null
            ? t("renewals.noExpiry")
            : days < 0
              ? t("renewals.expired", { days: String(-days) })
              : t("renewals.expiresIn", { days: String(days) });
        const customer =
          who(typeof item.customerId === "string" ? item.customerId : null, names) ?? shortRef(item.id);
        const policy = who(typeof item.policyRef === "string" ? item.policyRef : null, names);
        const state = t("renewals.state", {
          state: humanize(String(item.state ?? "")),
          strategy: humanize(String(item.strategy ?? ""))
        });
        const risk =
          typeof item.churnScore === "number" ? t("renewals.risk", { score: String(item.churnScore) }) : null;
        return (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={[customer, policy, state, when, risk].filter(Boolean).join(", ")}
            onPress={() => router.push(`/m/orbit-renewals/${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET,
              justifyContent: "center",
              gap: SPACE.xs,
              padding: SPACE.md,
              // Urgency on the leading edge, read before any word is.
              borderStartWidth: 3,
              borderStartColor: stripeOf(urgency, theme),
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceRaised : theme.surface
            })}
          >
            <Body chrome={chrome} style={{ fontWeight: "600" }}>
              {customer}
            </Body>
            {policy ? <Muted chrome={chrome}>{policy}</Muted> : null}
            <Muted chrome={chrome}>{state}</Muted>
            <Body chrome={chrome} style={{ color: urgency === "gone" ? theme.danger : theme.muted }}>
              {risk ? `${when} · ${risk}` : when}
            </Body>
          </Pressable>
        );
      }}
    />
  );
}

/** Urgency as a colour. Only a lapsed policy earns the danger token — if
 *  everything is red, nothing is. */
function stripeOf(
  urgency: Urgency,
  theme: { danger: string; accent: string; muted: string; border: string }
): string {
  if (urgency === "gone") return theme.danger;
  if (urgency === "now") return theme.accent;
  if (urgency === "soon") return theme.muted;
  return theme.border;
}
