import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction
} from "react-router";
import { cloudflare } from "../context";
import { Button, Card, Field, Input } from "@lyra/ui";
import { ApiError, api, apiFetch, relayCookies } from "../api.server";
import { CATALOGUES, DEFAULT_LOCALE, localeFrom, translator } from "../i18n";

// Password, then a TOTP step when the account is enrolled. Both hops run
// server-side and relay the API's Set-Cookie verbatim, so the session cookie
// stays HttpOnly and script never holds a credential. Federated addresses never
// reach the password field at all: discovery runs first and hands the browser
// to the provider.
//
// No product name on this page: there is no session yet, so there is no tenant
// brand to read one from, and a literal would be the hard-coded string the
// brand tokens exist to prevent.

/**
 * Strings that exist only on this screen. The shared catalogue carries the
 * vocabulary the whole shell speaks; a sentence said once, here, does not
 * belong in it.
 */
const LABELS: Record<string, Record<string, string>> = {
  en: {
    "sso.title": "Organisation sign-in",
    "sso.intro": "If your company signs you in, enter your work email and continue there.",
    "sso.button": "Continue with your organisation",
    "sso.error.email": "Enter your work email address first.",
    "sso.error.none": "That address does not use organisation sign-in. Use your password below.",
    "sso.error.failed": "Organisation sign-in could not be started. You can sign in with a password below.",
    "totp.recoveryHint": "Lost the device? Enter one of your recovery codes instead."
  },
  ar: {
    "sso.title": "تسجيل الدخول عبر المؤسسة",
    "sso.intro": "إذا كانت مؤسستك تتولّى تسجيل دخولك، أدخل بريد العمل ثم تابع لديها.",
    "sso.button": "المتابعة عبر مؤسستك",
    "sso.error.email": "أدخل بريد العمل أولًا.",
    "sso.error.none": "هذا العنوان لا يستخدم تسجيل الدخول عبر المؤسسة. استخدم كلمة المرور أدناه.",
    "sso.error.failed": "تعذّر بدء تسجيل الدخول عبر المؤسسة. يمكنك تسجيل الدخول بكلمة المرور أدناه.",
    "totp.recoveryHint": "فقدت جهازك؟ أدخل أحد رموز الاسترداد بدلًا من ذلك."
  }
};

function labeller(locale: string): (key: string) => string {
  const table = LABELS[locale] ?? LABELS[DEFAULT_LOCALE];
  return (key) => table?.[key] ?? LABELS[DEFAULT_LOCALE]?.[key] ?? key;
}

interface LoginResponse {
  mfaRequired: boolean;
  /** Which screen to draw. Absent when the account has no second factor to clear. */
  mfaStep?: "verify" | "enrol";
  user: { locale: string };
}

// The step the page can be *on*. Demo sign-in is a submitted step but never a
// rendered one: it either redirects or falls back to the password form.
type Step = "password" | "totp" | "enrol" | "recovery";

/** A seeded persona a demo deployment offers as a one-click door. */
interface Persona {
  email: string;
  name: string;
  roleKey: string;
}

type ActionData = {
  step: Step;
  /** i18n key, never a message. */
  errorKey?: string;
  /** Key into this file's own LABELS, for failures the shared catalogue has no word for. */
  localErrorKey?: string;
  /** The API's own words, shown under the translated message when it has any. */
  detail?: string;
  requestId?: string;
  needTenant?: boolean;
  /** Enrolment only. Shown once, and carried through a failed confirm. */
  secret?: string;
  otpauthUri?: string;
  /** Shown once, after enrolment. There is no route that reads them back. */
  recoveryCodes?: string[];
};

/**
 * The session cookie the API just issued. The enrolment call happens inside the
 * same action as the login that created the session, so the inbound request does
 * not carry it yet and it has to be forwarded by hand.
 */
function issuedCookie(headers: Headers): string | undefined {
  const set = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""].filter(Boolean);
  const pairs = set.map((c) => c.split(";")[0]).filter(Boolean);
  return pairs.length ? pairs.join("; ") : undefined;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const env = context.get(cloudflare).env;
  // Demo deployments offer one-click personas; production answers 404 to this
  // and the buttons simply never render. An unreachable API must not take the
  // password form down with it, so a failure here is an empty list.
  let personas: Persona[] = [];
  try {
    const response = await apiFetch("/v1/auth/demo/personas", { env });
    personas = ((await response.json()) as { data: Persona[] }).data;
  } catch {
    /* not a demo deployment */
  }
  return { locale: localeFrom(request), next: safeNext(url.searchParams.get("next")), personas };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: loaded }) => [
  { title: translator(loaded?.locale ?? "en")("auth.signIn") }
];

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflare).env;
  const form = await request.formData();
  const submitted = String(form.get("step") ?? "password");
  const step: Step = (["totp", "enrol", "recovery"] as const).includes(submitted as never)
    ? (submitted as Step)
    : "password";
  const next = safeNext(String(form.get("next") ?? ""));
  const headers = new Headers();

  // A button, not a separate form: the address is already typed into the field
  // above it, and asking for it twice is the reason nobody uses these.
  if (form.get("intent") === "sso") {
    const email = String(form.get("email") ?? "").trim();
    if (!email.includes("@")) return data<ActionData>({ step, localErrorKey: "sso.error.email" });
    try {
      const found = (await api<{ id?: string; startUrl?: string }>(
        `/v1/auth/sso/discover?email=${encodeURIComponent(email)}`,
        { env }
      )) ?? {};
      // Discovery answers `{}` for the ordinary case, which is not an error —
      // most addresses are not federated and the password form below is right.
      if (!found.id) return data<ActionData>({ step, localErrorKey: "sso.error.none" });
      // The provider hop is a browser navigation to the API origin, so this is
      // the one absolute redirect on the page. `next` rides in the state the API
      // holds for the round trip and comes back on the callback.
      const start = found.startUrl ?? `/v1/auth/sso/${found.id}/start`;
      return redirect(
        new URL(`${start}?next=${encodeURIComponent(next)}`, env.API_ORIGIN).toString()
      );
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return data<ActionData>({
        step,
        localErrorKey: "sso.error.failed",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
    }
  }

  try {
    if (submitted === "demo") {
      const response = await apiFetch("/v1/auth/demo/login", {
        env,
        method: "POST",
        body: { email: String(form.get("email") ?? "").trim() }
      });
      relayCookies(response, headers);
      const result = (await response.json()) as LoginResponse;
      if (CATALOGUES[result.user.locale]) {
        headers.append(
          "set-cookie",
          `lyra_locale=${result.user.locale}; Path=/; SameSite=Lax; Max-Age=31536000`
        );
      }
      return redirect(next, { headers });
    }

    if (step === "totp") {
      const response = await apiFetch("/v1/auth/mfa/verify", {
        env,
        request,
        method: "POST",
        body: { code: String(form.get("code") ?? "").trim() }
      });
      relayCookies(response, headers);
      return redirect(next, { headers });
    }

    if (step === "enrol") {
      const response = await apiFetch("/v1/auth/mfa/enrol/confirm", {
        env,
        request,
        method: "POST",
        body: { code: String(form.get("code") ?? "").trim() }
      });
      const { recoveryCodes } = (await response.json()) as { recoveryCodes: string[] };
      // Confirming clears the factor on this session, so the only thing between
      // here and the app is the user reading their codes.
      return data<ActionData>({ step: "recovery", recoveryCodes });
    }

    // The user has read the recovery codes. Nothing to call — the session is
    // already cleared.
    if (step === "recovery") return redirect(next);

    const response = await apiFetch("/v1/auth/login", {
      env,
      request,
      method: "POST",
      body: {
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
        ...(form.get("tenantSlug") ? { tenantSlug: String(form.get("tenantSlug")).trim() } : {})
      }
    });
    relayCookies(response, headers);

    const result = (await response.json()) as LoginResponse;
    // Remember the account's language so the next document — including the
    // sign-in page after a sign-out — renders in the right direction.
    if (CATALOGUES[result.user.locale]) {
      headers.append(
        "set-cookie",
        `lyra_locale=${result.user.locale}; Path=/; SameSite=Lax; Max-Age=31536000`
      );
    }
    if (result.mfaStep === "enrol") {
      // PLAT-013: this role cannot decline. Start enrolment in the same hop so
      // the user sees a setup key rather than a dead end.
      const started = await apiFetch("/v1/auth/mfa/enrol", {
        env,
        method: "POST",
        ...(issuedCookie(headers) ? { headers: { cookie: issuedCookie(headers) as string } } : {})
      });
      const enrolment = (await started.json()) as { secret: string; otpauthUri: string };
      return data<ActionData>({ step: "enrol", ...enrolment }, { headers });
    }
    if (result.mfaRequired) return data<ActionData>({ step: "totp" }, { headers });
    return redirect(next, { headers });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return data<ActionData>({
      step,
      errorKey: errorKeyFor(error, step),
      needTenant: /tenantslug/i.test(error.problem.detail ?? ""),
      // A rejected code must not cost the user their setup key — the API returns
      // it once and re-enrolling is a refusal.
      ...(step === "enrol" ? { secret: String(form.get("secret") ?? "") } : {}),
      ...(step === "enrol" && form.get("otpauthUri")
        ? { otpauthUri: String(form.get("otpauthUri")) }
        : {}),
      ...(error.problem.detail ? { detail: error.problem.detail } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {})
    });
  }
}

function errorKeyFor(error: ApiError, step: Step): string {
  if (step === "totp" || step === "enrol") return "auth.error.code";
  if (error.status === 401) return "auth.error.credentials";
  if (error.status === 403) return "auth.error.locked";
  if (error.status === 429) return "auth.error.throttled";
  if (error.status === 400 && /tenantslug/i.test(error.problem.detail ?? "")) {
    return "auth.tenantSlug.hint";
  }
  return "auth.error.generic";
}

/** Only ever redirect to a path on this origin. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function Login() {
  const { locale, next, personas } = useLoaderData<typeof loader>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const t = translator(locale);
  const label = labeller(locale);
  const busy = navigation.state !== "idle";
  // The step the API put us on survives a rejected code — a bad TOTP must not
  // drop the user back to a password form the session has already passed.
  const step: Step = result?.step ?? "password";
  const title = {
    password: "auth.signIn",
    totp: "auth.totp.title",
    enrol: "auth.enrol.title",
    recovery: "auth.recovery.title"
  }[step];
  const intro = {
    password: "auth.intro",
    totp: "auth.totp.intro",
    enrol: "auth.enrol.intro",
    recovery: "auth.recovery.intro"
  }[step];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <h1 className="font-display text-22">{t(title)}</h1>
        <p className="mt-1 text-13 text-muted">{t(intro)}</p>

        {result?.errorKey || result?.localErrorKey ? (
          <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3">
            <p className="text-13">
              {result.localErrorKey ? label(result.localErrorKey) : t(result.errorKey ?? "")}
            </p>
            {/* The API's own words, when it had any. Translated copy says what to
                do; this says what actually happened, and support needs both. */}
            {result.detail ? (
              <p className="mt-1 break-words text-12 text-muted">
                {t("error.detail")}: {result.detail}
              </p>
            ) : null}
            {result.requestId ? (
              <p className="mt-1 font-mono text-12 text-muted">
                {t("error.requestId", { id: result.requestId })}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === "password" && personas.length ? (
          <section className="mt-6" aria-labelledby="demo-heading">
            <h2 id="demo-heading" className="text-13 font-medium">
              {t("auth.demo.title")}
            </h2>
            <p className="mt-1 text-12 text-muted">{t("auth.demo.intro")}</p>
            <Form method="post" className="mt-3 grid gap-2">
              <input type="hidden" name="step" value="demo" />
              <input type="hidden" name="next" value={next} />
              {personas.map((persona) => (
                <Button
                  key={persona.email}
                  type="submit"
                  name="email"
                  value={persona.email}
                  disabled={busy}
                  className="justify-between"
                >
                  <span>{persona.name}</span>
                  {/* The role is the point of the persona — it says which
                      permissions the demo lands in. */}
                  <span className="font-mono text-12 text-muted">{persona.roleKey}</span>
                </Button>
              ))}
            </Form>
          </section>
        ) : null}

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          {step === "totp" ? (
            <>
              <input type="hidden" name="step" value="totp" />
              <Field label={t("auth.totp.code")} id="code">
                {/* This field takes either factor: six digits from the
                    authenticator, or a recovery code, which is XXXX-XXXX — nine
                    characters, letters and a dash. Numeric-only would silently
                    truncate the code a locked-out user is here to type. */}
                <Input
                  name="code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  pattern="[0-9A-Za-z-]*"
                  maxLength={9}
                  required
                  autoFocus
                />
              </Field>
              <p className="-mt-2 text-12 text-muted">{label("totp.recoveryHint")}</p>
            </>
          ) : step === "enrol" ? (
            <>
              <input type="hidden" name="step" value="enrol" />
              <input type="hidden" name="secret" value={result?.secret ?? ""} />
              <input type="hidden" name="otpauthUri" value={result?.otpauthUri ?? ""} />
              <div>
                <p className="text-13 font-medium">{t("auth.enrol.secret")}</p>
                {/* ponytail: setup key as selectable text, no QR. A QR needs an
                    encoder dependency; add one when phones outnumber desktops
                    on first sign-in. */}
                <p className="mt-1 select-all break-all rounded-md bg-surface-2 p-3 font-mono text-14 tracking-wide">
                  {result?.secret}
                </p>
                <p className="mt-1 text-12 text-muted">{t("auth.enrol.secretHint")}</p>
                {result?.otpauthUri ? (
                  <a className="mt-2 inline-block text-13 underline" href={result.otpauthUri}>
                    {t("auth.enrol.open")}
                  </a>
                ) : null}
              </div>
              <Field label={t("auth.totp.code")} id="code">
                <Input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  autoFocus
                />
              </Field>
            </>
          ) : step === "recovery" ? (
            <>
              <input type="hidden" name="step" value="recovery" />
              <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface-2 p-3 font-mono text-14">
                {(result?.recoveryCodes ?? []).map((code) => (
                  <li key={code} className="select-all">
                    {code}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <input type="hidden" name="step" value="password" />
              <Field label={t("auth.email")} id="email">
                {/* Focus follows the thing the user still has to answer: after a
                    workspace prompt the email is already right. */}
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus={!result?.needTenant}
                />
              </Field>
              <Field label={t("auth.password")} id="password">
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {result?.needTenant ? (
                <Field label={t("auth.tenantSlug")} id="tenantSlug">
                  <Input
                    name="tenantSlug"
                    autoComplete="organization"
                    required
                    autoFocus
                  />
                </Field>
              ) : null}
            </>
          )}

          <Button type="submit" variant="primary" loading={busy}>
            {busy
              ? t("auth.working")
              : t(
                  {
                    password: "auth.continue",
                    totp: "auth.totp.verify",
                    enrol: "auth.enrol.confirm",
                    recovery: "auth.recovery.continue"
                  }[step]
                )}
          </Button>

          {step === "password" ? (
            <div className="flex flex-col gap-1 border-t border-border pt-4">
              <h2 className="text-13 font-medium">{label("sso.title")}</h2>
              <p className="text-12 text-muted">{label("sso.intro")}</p>
              {/* Same form, same email field. `formNoValidate` because the
                  password below is required for the other button and not for
                  this one; the address is checked in the action either way. */}
              <Button
                type="submit"
                name="intent"
                value="sso"
                formNoValidate
                disabled={busy}
                className="mt-2"
              >
                {label("sso.button")}
              </Button>
            </div>
          ) : null}
        </Form>
      </Card>
    </main>
  );
}
