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
  user: { locale: string };
}

type ActionData = {
  step: "password" | "totp";
  /** i18n key, never a message. */
  errorKey?: string;
  /** The API's own words, shown under the translated message when it has any. */
  detail?: string;
  requestId?: string;
  needTenant?: boolean;
};

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return { locale: localeFrom(request), next: safeNext(url.searchParams.get("next")) };
}

export const meta: MetaFunction<typeof loader> = ({ data: loaded }) => [
  { title: translator(loaded?.locale ?? "en")("auth.signIn") }
];

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env;
  const form = await request.formData();
  const step = form.get("step") === "totp" ? "totp" : "password";
  const next = safeNext(String(form.get("next") ?? ""));
  const headers = new Headers();

  try {
    if (step === "totp") {
      // ponytail: /v1/auth/mfa/verify is specified in apps/api/src/openapi.ts
      // but not implemented yet. Wired to the spec'd endpoint; the 404 lands on
      // auth.totp.unavailable until the route ships.
      const response = await apiFetch("/v1/auth/mfa/verify", {
        env,
        request,
        method: "POST",
        body: { code: String(form.get("code") ?? "").trim() }
      });
      relayCookies(response, headers);
      return redirect(next, { headers });
    }

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
    if (result.mfaRequired) return data<ActionData>({ step: "totp" }, { headers });
    return redirect(next, { headers });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return data<ActionData>({
      step,
      errorKey: errorKeyFor(error, step),
      needTenant: /tenantslug/i.test(error.problem.detail ?? ""),
      ...(error.problem.detail ? { detail: error.problem.detail } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {})
    });
  }
}

function errorKeyFor(error: ApiError, step: "password" | "totp"): string {
  if (step === "totp") return error.status === 404 ? "auth.totp.unavailable" : "auth.error.code";
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
  const { locale, next } = useLoaderData<typeof loader>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const t = translator(locale);
  const busy = navigation.state !== "idle";
  const onTotp = result?.step === "totp" && !result.errorKey;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <h1 className="font-display text-22">{t(onTotp ? "auth.totp.title" : "auth.signIn")}</h1>
        <p className="mt-1 text-13 text-muted">{t(onTotp ? "auth.totp.intro" : "auth.intro")}</p>

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

        <Form method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          {onTotp ? (
            <>
              <input type="hidden" name="step" value="totp" />
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
            {busy ? t("auth.working") : t(onTotp ? "auth.totp.verify" : "auth.continue")}
          </Button>
        </Form>
      </Card>
    </main>
  );
}
