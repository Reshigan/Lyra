import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { I18nManager } from "react-native";
import { getLocales } from "expo-localization";
import {
  ApiError,
  confirmEnrolment,
  fetchMe,
  login,
  logout,
  mfaStepOf,
  setOnSessionEnd,
  startEnrolment,
  stepAfterLogin,
  verifyMfa,
  verifyThenLoad,
  type AuthStep,
  type Enrolment,
  type Me
} from "./api";
import { dirFor, resolveLocale, translator, type Translate } from "./i18n";
import { resolvePersona, type Persona } from "./workspace";
import {
  clearPendingRecoveryCodes,
  clearToken,
  readPendingRecoveryCodes,
  readToken,
  savePendingRecoveryCodes,
  saveToken
} from "./token";
import { productName, themeFor, type Theme } from "./theme";

// One bootstrap: the stored token, then /v1/me. Everything the screens draw —
// nav, brand, locale, name — comes from that single response, so a role or
// brand change lands on the next launch without an app update.

export type Status =
  /** Restoring the stored token; nothing may render yet. */
  | "loading"
  /** No usable session. */
  | "signedOut"
  /** Password accepted, second factor outstanding. */
  | "mfa"
  | "signedIn";

interface Session {
  status: Status;
  /** Which second-factor screen is outstanding while `status` is "mfa". */
  mfaStep: AuthStep | null;
  token: string | null;
  me: Me | null;
  /** Resolved once per session bootstrap from `me.roles`; fixed for the
   *  session's lifetime, same staleness contract as the web lens. */
  persona: Persona;
  locale: string;
  dir: "ltr" | "rtl";
  t: Translate;
  theme: Theme;
  /** Tenant product name, for the one place a title is shown. */
  brandName: string;
  /**
   * Why the stored session could not be restored — a dead network, not a
   * rejection. The token is kept, so this is a "try again", not a sign-out; the
   * sign-in screen shows it rather than presenting a bare password form to
   * someone who is already signed in and merely offline.
   */
  restoreError: unknown;
  signIn(input: { email: string; password: string; tenantSlug?: string }): Promise<Status>;
  verifyCode(code: string): Promise<void>;
  /** Starts enrolment and hands back the setup key to display. */
  enrol(): Promise<Enrolment>;
  /** Confirms enrolment and returns the recovery codes. Does *not* open the app:
   *  the codes are shown once and the user has to acknowledge them first. */
  confirmEnrol(code: string): Promise<string[]>;
  /**
   * Recovery codes issued but not yet acknowledged as saved. Kept in the
   * keystore from the moment they arrive — the server clears the factor on
   * confirm and never shows them again, so an app kill on the recovery screen
   * must not lose them. Non-null means "show the recovery screen".
   */
  pendingRecoveryCodes: string[] | null;
  /** The user confirmed the codes are stored; forget them. */
  recoveryCodesSaved(): Promise<void>;
  /** Re-reads /v1/me on a session whose factor is now cleared. */
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [mfaStep, setMfaStep] = useState<AuthStep | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);
  // Before sign-in there is no account locale, so the device's is the best
  // guess; /v1/me replaces it the moment there is a session.
  const [deviceLocale] = useState(() => resolveLocale(getLocales().map((l) => l.languageTag)));

  const load = useCallback(async (candidate: string): Promise<Status> => {
    setRestoreError(null);
    try {
      const loaded = await fetchMe(candidate);
      setMe(loaded);
      setToken(candidate);
      setMfaStep(null);
      setStatus("signedIn");
      return "signedIn";
    } catch (error) {
      // 401 is an expired or revoked session; a 403 mfa_required is a session
      // that exists but has not cleared its second factor. That is not a
      // sign-out — it is the screen the problem's `step` names.
      const step = mfaStepOf(error);
      if (step) {
        setToken(candidate);
        setMfaStep(step);
        setStatus("mfa");
        return "mfa";
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        await clearToken();
        setToken(null);
        setMe(null);
        setMfaStep(null);
        setStatus("signedOut");
        return "signedOut";
      }
      // Not a rejection — the API could not be reached at all. Record it before
      // rethrowing so a failed retry keeps showing why, rather than clearing the
      // message and leaving a bare form behind.
      setRestoreError(error);
      throw error;
    }
  }, []);

  // A 401 from any authenticated call means the session died server-side. One
  // handler in the api layer, so no screen is left showing "session ended"
  // with a Retry that re-sends a dead token.
  useEffect(() => {
    setOnSessionEnd(() => {
      void clearToken();
      setToken(null);
      setMe(null);
      setMfaStep(null);
      setStatus("signedOut");
    });
    return () => setOnSessionEnd(null);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [stored, pendingCodes] = await Promise.all([readToken(), readPendingRecoveryCodes()]);
      if (!live) return;
      // Codes the user never confirmed saving resurface on relaunch.
      setPendingRecoveryCodes(pendingCodes);
      if (!stored) {
        setStatus("signedOut");
        return;
      }
      // A dead network at launch must not wipe a valid session: only the API
      // saying "no" signs someone out.
      try {
        await load(stored);
      } catch {
        // `load` has already recorded why; the token stays so a retry is possible.
        if (live) {
          setToken(stored);
          setStatus("signedOut");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const signIn = useCallback<Session["signIn"]>(
    async (input) => {
      const result = await login(
        input.tenantSlug
          ? { email: input.email, password: input.password, tenantSlug: input.tenantSlug }
          : { email: input.email, password: input.password }
      );
      await saveToken(result.token);
      // The password round-trip just succeeded, so any "no connection" from a
      // failed restore is stale — without this it shows on the TOTP screen.
      setRestoreError(null);
      const step = stepAfterLogin(result);
      if (step !== "app") {
        setToken(result.token);
        setMfaStep(step);
        setStatus("mfa");
        return "mfa";
      }
      return load(result.token);
    },
    [load]
  );

  // One flag per token (useMemo identity): a load() that fails after a
  // successful verify is retried without re-spending the one-time code.
  const verifyFlow = useMemo(
    () =>
      token ? verifyThenLoad((code) => verifyMfa(token, code), () => load(token)) : null,
    [load, token]
  );
  const verifyCode = useCallback(
    async (code: string) => {
      if (!verifyFlow) throw new Error("no session to verify");
      await verifyFlow(code);
    },
    [verifyFlow]
  );

  const enrol = useCallback(async (): Promise<Enrolment> => {
    if (!token) throw new Error("no session to enrol");
    return startEnrolment(token);
  }, [token]);

  const confirmEnrol = useCallback(
    async (code: string): Promise<string[]> => {
      if (!token) throw new Error("no session to enrol");
      const codes = await confirmEnrolment(token, code);
      // The server has already cleared the factor and will never show these
      // again: persist before they render, so an app kill cannot lose them.
      // Best-effort — a broken keystore must not hide the codes now.
      await savePendingRecoveryCodes(codes).catch(() => undefined);
      setPendingRecoveryCodes(codes);
      return codes;
    },
    [token]
  );

  const recoveryCodesSaved = useCallback(async () => {
    await clearPendingRecoveryCodes();
    setPendingRecoveryCodes(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) throw new Error("no session to load");
    await load(token);
  }, [load, token]);

  const signOut = useCallback(async () => {
    // Revoke server-side first so a lost device stops working even if the local
    // wipe fails; a failure here still clears the device.
    if (token) await logout(token).catch(() => undefined);
    await clearToken();
    // Codes pending on sign-out belong to a session being abandoned; keeping
    // them would show one account's codes to the next.
    await clearPendingRecoveryCodes();
    setPendingRecoveryCodes(null);
    setToken(null);
    setMe(null);
    setMfaStep(null);
    setRestoreError(null);
    setStatus("signedOut");
  }, [token]);

  const locale = me?.profile?.locale ?? me?.locale ?? deviceLocale;

  // React Native only re-lays-out the native side after a reload, so ask for the
  // direction once per resolved locale and let each screen's `writingDirection`
  // carry the session in which the flag has not taken effect yet.
  useEffect(() => {
    const rtl = dirFor(locale) === "rtl";
    I18nManager.allowRTL(rtl);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }, [locale]);

  const value = useMemo<Session>(
    () => ({
      status,
      mfaStep,
      token,
      me,
      persona: resolvePersona(me?.roles ?? []),
      locale,
      dir: dirFor(locale),
      t: translator(locale),
      theme: themeFor(me?.tenant.brand),
      brandName: productName(me?.tenant.brand, me?.tenant.name ?? ""),
      restoreError,
      signIn,
      verifyCode,
      enrol,
      confirmEnrol,
      pendingRecoveryCodes,
      recoveryCodesSaved,
      refresh,
      signOut
    }),
    [
      status,
      mfaStep,
      token,
      me,
      locale,
      restoreError,
      signIn,
      verifyCode,
      enrol,
      confirmEnrol,
      pendingRecoveryCodes,
      recoveryCodesSaved,
      refresh,
      signOut
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
