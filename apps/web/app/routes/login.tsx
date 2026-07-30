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
import { ApiError, apiFetch, relayCookies } from "../api.server";
import { CATALOGUES, localeFrom, translator } from "../i18n";

// Password, then a TOTP step when the account is enrolled. Both hops run
// server-side and relay the API's Set-Cookie verbatim, so the session cookie
// stays HttpOnly and script never holds a credential.
//
// No product name on this page: there is no session yet, so there is no tenant
// brand to read one from, and a literal would be the hard-coded string the
// brand tokens exist to prevent.

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

        {result?.errorKey ? (
          <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3">
            <p className="text-13">{t(result.errorKey)}</p>
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
                <Input name="email" type="email" autoComplete="email" required autoFocus />
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
                  <Input name="tenantSlug" required />
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
        </Form>
      </Card>
    </main>
  );
}
