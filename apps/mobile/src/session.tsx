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
  startEnrolment,
  stepAfterLogin,
  verifyMfa,
  type AuthStep,
  type Enrolment,
  type Me
} from "./api";
import { dirFor, resolveLocale, translator, type Translate } from "./i18n";
import { clearToken, readToken, saveToken } from "./token";
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
  locale: string;
  dir: "ltr" | "rtl";
  t: Translate;
  theme: Theme;
  /** Tenant product name, for the one place a title is shown. */
  brandName: string;
  signIn(input: { email: string; password: string; tenantSlug?: string }): Promise<Status>;
  verifyCode(code: string): Promise<void>;
  /** Starts enrolment and hands back the setup key to display. */
  enrol(): Promise<Enrolment>;
  /** Confirms enrolment and returns the recovery codes. Does *not* open the app:
   *  the codes are shown once and the user has to acknowledge them first. */
  confirmEnrol(code: string): Promise<string[]>;
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
  // Before sign-in there is no account locale, so the device's is the best
  // guess; /v1/me replaces it the moment there is a session.
  const [deviceLocale] = useState(() => resolveLocale(getLocales().map((l) => l.languageTag)));

  const load = useCallback(async (candidate: string): Promise<Status> => {
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
      throw error;
    }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await readToken();
      if (!live) return;
      if (!stored) {
        setStatus("signedOut");
        return;
      }
      // A dead network at launch must not wipe a valid session: only the API
      // saying "no" signs someone out.
      try {
        await load(stored);
      } catch {
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

  const verifyCode = useCallback(
    async (code: string) => {
      if (!token) throw new Error("no session to verify");
      await verifyMfa(token, code);
      await load(token);
    },
    [load, token]
  );

  const enrol = useCallback(async (): Promise<Enrolment> => {
    if (!token) throw new Error("no session to enrol");
    return startEnrolment(token);
  }, [token]);

  const confirmEnrol = useCallback(
    async (code: string): Promise<string[]> => {
      if (!token) throw new Error("no session to enrol");
      return confirmEnrolment(token, code);
    },
    [token]
  );

  const refresh = useCallback(async () => {
    if (!token) throw new Error("no session to load");
    await load(token);
  }, [load, token]);

  const signOut = useCallback(async () => {
    // Revoke server-side first so a lost device stops working even if the local
    // wipe fails; a failure here still clears the device.
    if (token) await logout(token).catch(() => undefined);
    await clearToken();
    setToken(null);
    setMe(null);
    setMfaStep(null);
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
      locale,
      dir: dirFor(locale),
      t: translator(locale),
      theme: themeFor(me?.tenant.brand),
      brandName: productName(me?.tenant.brand, me?.tenant.name ?? ""),
      signIn,
      verifyCode,
      enrol,
      confirmEnrol,
      refresh,
      signOut
    }),
    [status, mfaStep, token, me, locale, signIn, verifyCode, enrol, confirmEnrol, refresh, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
