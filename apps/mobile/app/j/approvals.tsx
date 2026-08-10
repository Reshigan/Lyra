import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  decideApproval,
  fetchInbox,
  markNotificationRead,
  type Inbox
} from "../../src/api";
import { approvalAmountMinor, approvalTitle } from "../../src/journeys";
import { useSession } from "../../src/session";
import { RADIUS, SPACE } from "../../src/theme";
import {
  Body,
  Button,
  Field,
  Loading,
  Muted,
  Notice,
  Title,
  errorKeyFor,
  requestIdOf,
  type Chrome
} from "../../src/ui";
import { useLoad } from "../../src/useLoad";

// J-M2 on a phone: the one queue that spans every module. The API decides what
// a user may approve and writes the audit row (CLAUDE.md rules 3, 4); this
// screen only asks the question and reports the answer.

const EMPTY: Inbox = { approvals: [], notifications: [], counts: { approvals: 0, notifications: 0 } };

export default function Approvals() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  /** The approval whose rejection reason is being typed — a rejection without a
   *  reason is a decision the requester cannot act on. */
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  const [writeError, setWriteError] = useState<unknown>(null);

  const inbox = useLoad(
    (signal) => (token ? fetchInbox(token, signal) : Promise.resolve(EMPTY)),
    [token]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const data = inbox.data ?? EMPTY;

  const decide = async (id: string, decision: "approved" | "rejected") => {
    if (!token || busyId) return;
    setBusyId(id);
    setWriteError(null);
    try {
      await decideApproval(token, id, decision, decision === "rejected" ? reason.trim() : undefined);
      setDecided(true);
      setRejecting(null);
      setReason("");
      inbox.reload();
    } catch (caught) {
      setWriteError(caught);
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (id: string) => {
    if (!token || busyId) return;
    setBusyId(id);
    setWriteError(null);
    try {
      await markNotificationRead(token, id);
      inbox.reload();
    } catch (caught) {
      setWriteError(caught);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        gap: SPACE.lg,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
    >
      <Title chrome={chrome}>{t("approvals.title")}</Title>

      {inbox.loading ? <Muted chrome={chrome}>{t("app.loading")}</Muted> : null}

      {inbox.error ? (
        <>
          <Notice
            chrome={chrome}
            message={t(errorKeyFor(inbox.error))}
            requestId={requestIdOf(inbox.error)}
          />
          <Button chrome={chrome} variant="quiet" label={t("error.retry")} onPress={inbox.reload} />
        </>
      ) : null}

      {writeError ? (
        <Notice
          chrome={chrome}
          message={t(errorKeyFor(writeError))}
          requestId={requestIdOf(writeError)}
        />
      ) : null}

      {decided ? <Muted chrome={chrome}>{t("approvals.decided")}</Muted> : null}

      {data.approvals.length ? (
        data.approvals.map((approval) => {
          const amount = approvalAmountMinor(approval);
          const open = rejecting === approval.id;
          return (
            <Card chrome={chrome} key={approval.id}>
              <Body chrome={chrome} style={{ fontWeight: "600" }}>
                {approvalTitle(approval)}
              </Body>
              <Muted chrome={chrome}>
                {t("approvals.subject", { subject: approval.subjectRef })}
              </Muted>
              {approval.requestedBy ? (
                <Muted chrome={chrome}>
                  {t("approvals.requestedBy", { name: approval.requestedBy })}
                </Muted>
              ) : null}
              {amount !== null ? (
                <Body chrome={chrome}>
                  {t("approvals.amount", { amount: (amount / 100).toFixed(2) })}
                </Body>
              ) : null}

              {open ? (
                <>
                  <Field
                    chrome={chrome}
                    label={t("approvals.reason")}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    autoFocus
                  />
                  <Muted chrome={chrome}>{t("approvals.reasonHint")}</Muted>
                  <Button
                    chrome={chrome}
                    label={t("approvals.confirmReject")}
                    busy={busyId === approval.id}
                    disabled={!reason.trim()}
                    onPress={() => decide(approval.id, "rejected")}
                  />
                  <Button
                    chrome={chrome}
                    variant="quiet"
                    label={t("approvals.cancel")}
                    onPress={() => {
                      setRejecting(null);
                      setReason("");
                    }}
                  />
                </>
              ) : (
                <>
                  <Button
                    chrome={chrome}
                    label={t("approvals.approve")}
                    busy={busyId === approval.id}
                    onPress={() => decide(approval.id, "approved")}
                  />
                  <Button
                    chrome={chrome}
                    variant="quiet"
                    label={t("approvals.reject")}
                    onPress={() => {
                      setRejecting(approval.id);
                      setReason("");
                    }}
                  />
                </>
              )}
            </Card>
          );
        })
      ) : inbox.loading ? null : (
        <Body chrome={chrome} style={{ color: theme.muted }}>
          {t("approvals.empty")}
        </Body>
      )}

      {data.notifications.length ? (
        <Card chrome={chrome}>
          <Body chrome={chrome} style={{ fontWeight: "600" }}>
            {t("approvals.notifications")}
          </Body>
          {data.notifications.map((notification) => (
            <View key={notification.id} style={{ gap: SPACE.xs }}>
              <Body chrome={chrome}>{notification.title}</Body>
              {notification.bodyText ? (
                <Muted chrome={chrome}>{notification.bodyText}</Muted>
              ) : null}
              <Button
                chrome={chrome}
                variant="quiet"
                label={t("approvals.markRead")}
                busy={busyId === notification.id}
                onPress={() => dismiss(notification.id)}
              />
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Card({ chrome, children }: { chrome: Chrome; children: React.ReactNode }) {
  return (
    <View
      style={{
        gap: SPACE.sm,
        padding: SPACE.lg,
        borderRadius: RADIUS.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: chrome.theme.border,
        backgroundColor: chrome.theme.surface
      }}
    >
      {children}
    </View>
  );
}
