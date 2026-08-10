import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uploadDocument } from "../../src/api";
import { DOC_TYPES, contentTypeOf, type DocType } from "../../src/journeys";
import { useSession } from "../../src/session";
import { RADIUS, SPACE, TOUCH_TARGET } from "../../src/theme";
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

// The AXIS field capture: a licence disc or an ID in front of someone becomes an
// `axis_documents` row in one call. Nothing is read on device — extraction is a
// separate audited server call, so this screen only carries bytes.

export default function Capture() {
  const session = useSession();
  const chrome: Chrome = { theme: session.theme, t: session.t, dir: session.dir };
  const { t, theme, token } = session;
  const insets = useSafeAreaInsets();
  const [caseId, setCaseId] = useState("");
  const [docType, setDocType] = useState<DocType>("eid");
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  /** Either a caught API error or one of our own i18n keys — the screen tells a
   *  missing case apart from a rejected upload without a second slot of state. */
  const [problem, setProblem] = useState<unknown>(null);

  if (session.status === "loading") return <Loading chrome={chrome} />;
  if (session.status !== "signedIn") return <Redirect href="/login" />;

  const take = async (fromCamera: boolean) => {
    setProblem(null);
    setDone(false);
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setProblem("capture.denied");
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled) return;
    setUri(result.assets[0]?.uri ?? null);
  };

  const upload = async () => {
    if (!token || busy) return;
    if (!caseId.trim()) return setProblem("capture.needsCase");
    if (!uri) return setProblem("capture.needsFile");
    setBusy(true);
    setProblem(null);
    try {
      await uploadDocument(token, {
        caseId: caseId.trim(),
        docType,
        uri,
        contentType: contentTypeOf(uri)
      });
      setDone(true);
      setUri(null);
    } catch (caught) {
      setProblem(caught);
    } finally {
      setBusy(false);
    }
  };

  const message =
    typeof problem === "string" ? t(problem) : problem ? t(errorKeyFor(problem)) : null;

  return (
    <ScrollView
      contentContainerStyle={{
        gap: SPACE.lg,
        padding: SPACE.lg,
        paddingTop: insets.top + SPACE.lg,
        paddingBottom: insets.bottom + SPACE.xl
      }}
    >
      <Title chrome={chrome}>{t("capture.title")}</Title>

      {message ? (
        <Notice chrome={chrome} message={message} requestId={requestIdOf(problem)} />
      ) : null}
      {done ? <Muted chrome={chrome}>{t("capture.uploaded")}</Muted> : null}

      <Field
        chrome={chrome}
        label={t("capture.case")}
        value={caseId}
        onChangeText={setCaseId}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Muted chrome={chrome}>{t("capture.caseHint")}</Muted>

      <View style={{ gap: SPACE.sm }}>
        <Body chrome={chrome} style={{ fontWeight: "600" }}>
          {t("capture.docType")}
        </Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
          {DOC_TYPES.map((type) => {
            const active = type === docType;
            return (
              <Pressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(`docType.${type}`)}
                onPress={() => setDocType(type)}
                style={{
                  minHeight: TOUCH_TARGET,
                  justifyContent: "center",
                  paddingHorizontal: SPACE.md,
                  borderRadius: RADIUS.sm,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? theme.accent : theme.border,
                  backgroundColor: active ? theme.surfaceRaised : theme.surface
                }}
              >
                <Body chrome={chrome}>{t(`docType.${type}`)}</Body>
              </Pressable>
            );
          })}
        </View>
      </View>

      {uri ? (
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          style={{ height: 220, borderRadius: RADIUS.md, backgroundColor: theme.surfaceRaised }}
          resizeMode="contain"
        />
      ) : null}

      <Button
        chrome={chrome}
        variant="quiet"
        label={uri ? t("capture.retake") : t("capture.take")}
        onPress={() => take(true)}
      />
      <Button chrome={chrome} variant="quiet" label={t("capture.pick")} onPress={() => take(false)} />
      <Button chrome={chrome} label={t("capture.upload")} busy={busy} onPress={upload} />
    </ScrollView>
  );
}
