import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, NetworkError, type Enrolment } from "../src/api";
import { useSession } from "../src/session";
import { RADIUS, SPACE, TEXT } from "../src/theme";
import {
  Body,
  Button,
  Field,
  Loading,
  Notice,
  Title,
  errorKeyFor,
  requestIdOf,
  type Chrome
} from "../src/ui";

// Password, then the second factor: an enrolled account types a code, a role
// that must have one but never set it up enrols here and reads its recovery
// codes before the app opens. Same step machine as the web shell
// (apps/web/app/routes/login.tsx), driven by the API's own `mfaStep`.
//
// No product name on this screen: there is no session yet, so there is no tenant
// brand to read one from, and a literal would be exactly the hard-coded string
// brand tokens exist to prevent (CLAUDE.md §5).

type Screen = "password" | "totp" | "enrol" | "recovery";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const TITLE: Record<Screen, string> = {
  password: "auth.signIn",
  totp: "auth.totp.title",
  enrol: "auth.enrol.title",
  recovery: "auth.recovery.title"
};
const INTRO: Record<Screen, string> = {
  password: "auth.intro",
  totp: "auth.totp.intro",
  enrol: "auth.enrol.intro",
  recovery: "auth.recovery.intro"
};
const ACTION: Record<Screen, string> = {
  password: "auth.continue",
  totp: "auth.totp.verify",
  enrol: "auth.enrol.confirm",
  recovery: "auth.recovery.continue"
};

export default function Login() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme } = session;
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [needTenant, setNeedTenant] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);

  // The step the API put us on — from the login response or from the 403 on a
  // restored session, so relaunching mid-enrolment lands on the same screen.
  const step: Screen =
    session.status === "mfa" ? (session.mfaStep === "enrol" ? "enrol" : "totp") : "password";
  // Unacknowledged codes take priority over everything, including a session
  // that is otherwise already signedIn: the server clears the factor the
  // moment they are issued, so a kill before "I have saved them" leaves
  // status signedIn on relaunch with the codes still owed to the user.
  const screen: Screen = session.pendingRecoveryCodes ? "recovery" : step;

  const { enrol } = session;
  useEffect(() => {
    if (screen !== "enrol" || enrolment) return;
    let live = true;
    // Fetch the setup key as soon as we land here: a screen that asks for a code
    // before showing the key it comes from is a dead end.
    void enrol().then(
      (started) => {
        if (live) setEnrolment(started);
      },
      (error: unknown) => {
        if (!live) return;
        setRequestId(error instanceof ApiError ? error.requestId : null);
        setErrorKey(error instanceof NetworkError ? "error.network" : "auth.error.generic");
      }
    );
    return () => {
      live = false;
    };
  }, [screen, enrolment, enrol]);

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (screen !== "recovery" && session.status === "signedIn") return <Redirect href="/" />;

  const fail = (error: unknown, from: Screen) => {
    setRequestId(error instanceof ApiError ? error.requestId : null);
    if (error instanceof NetworkError) return setErrorKey("error.network");
    if (!(error instanceof ApiError)) return setErrorKey("auth.error.generic");

    // The MFA routes throttle per session, and "too many attempts" is never
    // "wrong code".
    if (error.status === 429) return setErrorKey("auth.error.throttled");
    // Both code screens reject the same way: /v1/auth/mfa/verify and
    // /v1/auth/mfa/enrol/confirm answer 401 when the code is not accepted.
    if (from === "totp" || from === "enrol") return setErrorKey("auth.error.code");

    const wantsTenant = /tenantslug/i.test(error.problem.detail ?? "");
    if (wantsTenant) setNeedTenant(true);
    if (error.status === 401) return setErrorKey("auth.error.credentials");
    if (error.status === 403) return setErrorKey("auth.error.locked");
    if (error.status === 400 && wantsTenant) return setErrorKey("auth.tenantSlug.hint");
    return setErrorKey("auth.error.generic");
  };

  const submit = async () => {
    setBusy(true);
    setErrorKey(null);
    setRequestId(null);
    try {
      if (screen === "totp") await session.verifyCode(code.trim());
      else if (screen === "enrol") {
        // Retry path: the key never arrived, so there is nothing to confirm yet.
        if (!enrolment) setEnrolment(await session.enrol());
        // Confirming sets session.pendingRecoveryCodes, which is what drives
        // `screen` into "recovery" — no local copy of the codes to hold.
        else await session.confirmEnrol(code.trim());
      } else if (screen === "recovery") {
        // Acknowledge first so a kill right after this line cannot leave the
        // codes stranded in the keystore, then re-read /v1/me: the server
        // already cleared the factor when the enrolment was confirmed.
        await session.recoveryCodesSaved();
        await session.refresh();
      } else
        await session.signIn({
          email: email.trim(),
          password,
          ...(tenantSlug.trim() ? { tenantSlug: tenantSlug.trim() } : {})
        });
    } catch (error) {
      fail(error, screen);
    } finally {
      setBusy(false);
    }
  };

  const box = {
    gap: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          gap: SPACE.lg,
          padding: SPACE.xl,
          paddingTop: insets.top + SPACE.xl,
          paddingBottom: insets.bottom + SPACE.xl
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: SPACE.xs }}>
          <Title chrome={chrome}>{t(TITLE[screen])}</Title>
          <Body chrome={chrome} style={{ color: theme.muted }}>
            {t(INTRO[screen])}
          </Body>
        </View>

        {errorKey ? <Notice chrome={chrome} message={t(errorKey)} requestId={requestId} /> : null}

        {/* A stored session that could not be restored — offline, or the API
            unreachable. Without this the user is shown a password form with no
            explanation for why they were signed out, and retyping a password
            fixes nothing when the network is the problem. */}
        {!errorKey && session.restoreError ? (
          <>
            <Notice
              chrome={chrome}
              message={t(errorKeyFor(session.restoreError))}
              requestId={requestIdOf(session.restoreError)}
            />
            {session.token ? (
              <Button
                chrome={chrome}
                variant="quiet"
                label={t("error.retry")}
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void session
                    .refresh()
                    .catch(() => undefined)
                    .finally(() => setBusy(false));
                }}
              />
            ) : null}
          </>
        ) : null}

        {screen === "recovery" ? (
          <View style={box}>
            {(session.pendingRecoveryCodes ?? []).map((recovery) => (
              <Body
                key={recovery}
                chrome={chrome}
                selectable
                style={{ fontFamily: MONO, fontSize: TEXT.s16 }}
              >
                {recovery}
              </Body>
            ))}
          </View>
        ) : screen === "enrol" ? (
          <>
            <View style={{ gap: SPACE.sm }}>
              <Body chrome={chrome} style={{ color: theme.muted, fontSize: TEXT.s13 }}>
                {t("auth.enrol.secret")}
              </Body>
              {/* ponytail: setup key as selectable text, no QR — a QR needs an
                  encoder dependency, and the web shell shows the key the same
                  way. Add one when scanning beats pasting for enough people. */}
              <View style={box}>
                {/* ponytail: the one testID in this app — a fresh, random
                    setup key has no fixed text or label for Detox to match on
                    (unlike every interactive control, which already carries
                    its own accessibilityLabel), so e2e/01-sign-in-enrol.e2e.ts
                    reads it via getAttributes() instead. */}
                <Body
                  chrome={chrome}
                  selectable
                  testID="enrol-secret"
                  style={{ fontFamily: MONO, fontSize: TEXT.s16, letterSpacing: 1 }}
                >
                  {enrolment?.secret ?? "…"}
                </Body>
              </View>
              <Body chrome={chrome} style={{ color: theme.muted, fontSize: TEXT.s12 }}>
                {t("auth.enrol.secretHint")}
              </Body>
            </View>
            {enrolment ? (
              <Button
                chrome={chrome}
                variant="quiet"
                label={t("auth.enrol.open")}
                onPress={() => void Linking.openURL(enrolment.otpauthUri).catch(() => undefined)}
              />
            ) : null}
            <Field
              chrome={chrome}
              label={t("auth.totp.code")}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          </>
        ) : screen === "totp" ? (
          <Field
            chrome={chrome}
            label={t("auth.totp.code")}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            // Long enough for a pasted recovery code (XXXX-XXXX), which
            // /v1/auth/mfa/verify accepts in place of a TOTP.
            maxLength={9}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        ) : (
          <>
            <Field
              chrome={chrome}
              label={t("auth.email")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Field
              chrome={chrome}
              label={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              autoCapitalize="none"
              returnKeyType={needTenant ? "next" : "go"}
              onSubmitEditing={() => {
                if (!needTenant) void submit();
              }}
            />
            {needTenant ? (
              <Field
                chrome={chrome}
                label={t("auth.tenantSlug")}
                value={tenantSlug}
                onChangeText={setTenantSlug}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            ) : null}
          </>
        )}

        <Button
          chrome={chrome}
          label={busy ? t("auth.working") : t(ACTION[screen])}
          busy={busy}
          onPress={() => void submit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
