import { forwardRef } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle
} from "react-native";
import { ApiError, NetworkError } from "./api";
import type { Translate } from "./i18n";
import { RADIUS, SPACE, TEXT, TOUCH_TARGET, type Theme } from "./theme";

// The handful of primitives every screen here needs. Styles are built per theme
// because the palette is tenant configuration, not a constant. Layout uses only
// logical edges (Start/End), so RTL flips without a second stylesheet.

export interface Chrome {
  theme: Theme;
  t: Translate;
  dir: "ltr" | "rtl";
}

export function Body({ chrome, style, selectable, children }: {
  chrome: Chrome;
  style?: TextStyle;
  /** For values a user has to copy out — a setup key, a recovery code. */
  selectable?: boolean;
  children: ReactNode;
}) {
  return (
    <Text
      selectable={selectable}
      style={[
        {
          color: chrome.theme.text,
          fontSize: TEXT.s14,
          lineHeight: TEXT.s14 * 1.5,
          writingDirection: chrome.dir
        },
        style
      ]}
    >
      {children}
    </Text>
  );
}

export function Title({ chrome, children }: { chrome: Chrome; children: ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: chrome.theme.text,
        fontSize: TEXT.s28,
        fontWeight: "700",
        lineHeight: TEXT.s28 * 1.15,
        writingDirection: chrome.dir
      }}
    >
      {children}
    </Text>
  );
}

export function Muted({ chrome, children }: { chrome: Chrome; children: ReactNode }) {
  return (
    <Text
      style={{
        color: chrome.theme.muted,
        fontSize: TEXT.s13,
        lineHeight: TEXT.s13 * 1.5,
        writingDirection: chrome.dir
      }}
    >
      {children}
    </Text>
  );
}

export function Button({
  chrome,
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false
}: {
  chrome: Chrome;
  /** Already translated. Rendered as text, and used as the accessible name. */
  label: string;
  onPress: () => void;
  variant?: "primary" | "quiet";
  busy?: boolean;
  disabled?: boolean;
}) {
  const primary = variant === "primary";
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: SPACE.lg,
        borderRadius: RADIUS.md,
        opacity: inert ? 0.5 : 1,
        backgroundColor: primary
          ? pressed
            ? chrome.theme.accentHover
            : chrome.theme.accent
          : pressed
            ? chrome.theme.surfaceRaised
            : "transparent",
        borderWidth: primary ? 0 : StyleSheet.hairlineWidth,
        borderColor: chrome.theme.border
      })}
    >
      {busy ? (
        <ActivityIndicator color={primary ? chrome.theme.accentContrast : chrome.theme.text} />
      ) : (
        <Text
          style={{
            color: primary ? chrome.theme.accentContrast : chrome.theme.text,
            fontSize: TEXT.s16,
            fontWeight: "600",
            writingDirection: chrome.dir
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A labelled input. The label is a real, visible Text — a placeholder is not a
 *  label, and a field whose name disappears on first keystroke fails 3.3.2. */
export const Field = forwardRef<TextInput, { chrome: Chrome; label: string } & TextInputProps>(
  function Field({ chrome, label, style, ...props }, ref) {
    return (
      <View style={{ gap: SPACE.sm }}>
        <Text
          nativeID={`${label}-label`}
          style={{
            color: chrome.theme.muted,
            fontSize: TEXT.s13,
            fontWeight: "500",
            writingDirection: chrome.dir
          }}
        >
          {label}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          placeholderTextColor={chrome.theme.subtle}
          style={[
            {
              minHeight: TOUCH_TARGET,
              paddingHorizontal: SPACE.md,
              paddingVertical: SPACE.sm,
              borderRadius: RADIUS.sm,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: chrome.theme.border,
              backgroundColor: chrome.theme.surfaceRaised,
              color: chrome.theme.text,
              fontSize: TEXT.s16,
              textAlign: chrome.dir === "rtl" ? "right" : "left",
              writingDirection: chrome.dir
            },
            style
          ]}
          {...props}
        />
      </View>
    );
  }
);

/** Errors announce themselves; a message a screen reader never reads is a
 *  message that was not shown. */
export function Notice({
  chrome,
  message,
  requestId
}: {
  chrome: Chrome;
  message: string;
  requestId?: string | null;
}) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        gap: SPACE.xs,
        padding: SPACE.md,
        borderRadius: RADIUS.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: chrome.theme.danger,
        backgroundColor: chrome.theme.surface
      }}
    >
      <Text style={{ color: chrome.theme.text, fontSize: TEXT.s14, writingDirection: chrome.dir }}>
        {message}
      </Text>
      {requestId ? (
        <Text style={{ color: chrome.theme.muted, fontSize: TEXT.s12 }}>
          {chrome.t("error.requestId", { id: requestId })}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading({ chrome }: { chrome: Chrome }) {
  return (
    <View
      accessible
      accessibilityLabel={chrome.t("app.loading")}
      style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
    >
      <ActivityIndicator color={chrome.theme.accent} />
    </View>
  );
}

/** The i18n key for a caught error. Keeps every screen's catch block to one line
 *  and keeps the mapping in one place when a new status starts mattering. */
export function errorKeyFor(error: unknown): string {
  if (error instanceof NetworkError) return "error.network";
  if (!(error instanceof ApiError)) return "error.generic";
  if (error.status === 401) return "error.unauthorized";
  if (error.status === 403) return "error.forbidden";
  if (error.status === 404) return "error.notFound";
  return "error.generic";
}

export function requestIdOf(error: unknown): string | null {
  return error instanceof ApiError ? error.requestId : null;
}
