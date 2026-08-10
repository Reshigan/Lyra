import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { queryRows, replyToConversation, type Row } from "../../../src/api";
import { isInbound, threadOrder } from "../../../src/journeys";
import { useSession } from "../../../src/session";
import { RADIUS, SPACE } from "../../../src/theme";
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
} from "../../../src/ui";
import { useLoad } from "../../../src/useLoad";

// One conversation, read the way it happened, with a composer. The reply goes
// out over whatever channel the conversation is bound to (ADR-0038); this
// screen never picks a transport.

const ROLE_KEYS: Record<string, "thread.customer" | "thread.agent" | "thread.assistant" | "thread.system"> = {
  customer: "thread.customer",
  agent_human: "thread.agent",
  agent_ai: "thread.assistant",
  system: "thread.system"
};

export default function Thread() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [writeError, setWriteError] = useState<unknown>(null);

  const page = useLoad(
    (signal) =>
      token && id
        ? queryRows(token, "orbit/messages", { conversationId: id, limit: 100 }, signal)
        : Promise.resolve({ data: [] as Row[] }),
    [token, id]
  );

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const messages = threadOrder(page.data?.data ?? []);

  const send = async () => {
    const body = text.trim();
    if (!token || !id || !body || sending) return;
    setSending(true);
    setWriteError(null);
    try {
      await replyToConversation(token, id, body);
      setText("");
      setSent(true);
      page.reload();
    } catch (caught) {
      setWriteError(caught);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          gap: SPACE.md,
          padding: SPACE.lg,
          paddingTop: insets.top + SPACE.lg
        }}
      >
        <View style={{ alignSelf: session.dir === "rtl" ? "flex-end" : "flex-start" }}>
          <Button
            chrome={chrome}
            variant="quiet"
            label={t("nav.back")}
            onPress={() => router.back()}
          />
        </View>
        <Title chrome={chrome}>{t("thread.title")}</Title>

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

        {messages.length ? (
          messages.map((message) => {
            const inbound = isInbound(message);
            const roleKey = ROLE_KEYS[String(message.role ?? "")] ?? "thread.system";
            return (
              <View
                key={message.id}
                accessible
                style={{
                  gap: SPACE.xs,
                  maxWidth: "88%",
                  alignSelf: inbound ? "flex-start" : "flex-end",
                  padding: SPACE.md,
                  borderRadius: RADIUS.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.border,
                  backgroundColor: inbound ? theme.surface : theme.surfaceRaised
                }}
              >
                <Muted chrome={chrome}>{t(roleKey)}</Muted>
                <Body chrome={chrome}>{String(message.content ?? "")}</Body>
              </View>
            );
          })
        ) : page.loading ? null : (
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {t("thread.noMessages")}
          </Body>
        )}
      </ScrollView>

      <View
        style={{
          gap: SPACE.sm,
          padding: SPACE.lg,
          paddingBottom: insets.bottom + SPACE.lg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.border,
          backgroundColor: theme.surface
        }}
      >
        {writeError ? (
          <Notice
            chrome={chrome}
            message={t(errorKeyFor(writeError))}
            requestId={requestIdOf(writeError)}
          />
        ) : null}
        {sent ? <Muted chrome={chrome}>{t("thread.sent")}</Muted> : null}
        <Field
          chrome={chrome}
          label={t("thread.reply")}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setSent(false);
          }}
          multiline
          maxLength={20_000}
        />
        <Button
          chrome={chrome}
          label={t("thread.send")}
          busy={sending}
          disabled={!text.trim()}
          onPress={send}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
